import subprocess
import threading
import time
from datetime import datetime, timedelta
import os

class GitSyncManager:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(GitSyncManager, cls).__new__(cls)
                cls._instance.initialized = False
            return cls._instance

    def init(self, repo_path: str):
        if self.initialized:
            return
        self.repo_path = repo_path
        self.status = "SUCCESS"  # SUCCESS, SYNCING, FAILED
        self.error_message = None
        self.last_sync_time = None
        self.last_commit = None
        self.uncommitted_changes = False
        self.need_push = False
        self._sync_lock = threading.Lock()
        
        # Start background thread loop
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        self.initialized = True

    def _run_cmd(self, args: list) -> tuple:
        try:
            res = subprocess.run(
                args,
                cwd=self.repo_path,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=True
            )
            return res.stdout.strip(), None
        except subprocess.CalledProcessError as e:
            err_output = e.stderr.strip() or e.stdout.strip() or str(e)
            return None, err_output
        except Exception as e:
            return None, str(e)

    def _run_loop(self):
        time.sleep(5)
        while True:
            try:
                self.check_and_sync()
            except Exception as e:
                print(f"[Git Sync Loop Error] {e}")
            time.sleep(15)

    def check_and_sync(self):
        with self._sync_lock:
            # 1. Check if there are changes
            stdout, err = self._run_cmd(["git", "status", "--porcelain"])
            if err:
                self.status = "FAILED"
                self.error_message = f"Git status failed: {err}"
                return

            has_changes = bool(stdout.strip())
            self.uncommitted_changes = has_changes

            # 2. Check if local is ahead of remote
            upstream_stdout, upstream_err = self._run_cmd(["git", "rev-parse", "--abbrev-ref", "@{u}"])
            if not upstream_err and upstream_stdout:
                log_stdout, log_err = self._run_cmd(["git", "log", "@{u}..HEAD", "--oneline"])
                self.need_push = bool(log_stdout and log_stdout.strip())
            else:
                self.need_push = False

            # 3. Stage & Commit & Push if there are changes or local commits to push
            if has_changes or self.need_push:
                if self.status != "SYNCING":
                    self._perform_sync_internal()

    def perform_sync(self):
        with self._sync_lock:
            self._perform_sync_internal()

    def _perform_sync_internal(self):
        self.status = "SYNCING"
        self.error_message = None

        # Check for uncommitted changes
        status_stdout, status_err = self._run_cmd(["git", "status", "--porcelain"])
        if status_err:
            self.status = "FAILED"
            self.error_message = f"Git status check failed: {status_err}"
            return

        has_changes = bool(status_stdout and status_stdout.strip())

        if has_changes:
            # Stage all changes
            _, err = self._run_cmd(["git", "add", "-A"])
            if err:
                self.status = "FAILED"
                self.error_message = f"Git add failed: {err}"
                return

            # Check staged changes
            diff_stdout, diff_err = self._run_cmd(["git", "diff", "--cached", "--name-only"])
            if diff_err:
                self.status = "FAILED"
                self.error_message = f"Git diff failed: {diff_err}"
                return

            if diff_stdout and diff_stdout.strip():
                # Construct commit message listing updated files
                files = [line.strip() for line in diff_stdout.split("\n") if line.strip()]
                if len(files) == 1:
                    commit_msg = f"Auto-sync: updated {files[0]}"
                elif len(files) <= 3:
                    commit_msg = f"Auto-sync: updated {', '.join(files)}"
                else:
                    commit_msg = f"Auto-sync: updated {', '.join(files[:3])} and {len(files) - 3} other files"

                # Commit changes
                _, err = self._run_cmd(["git", "commit", "-m", commit_msg])
                if err:
                    self.status = "FAILED"
                    self.error_message = f"Git commit failed: {err}"
                    return

        # Push to remote
        branch_stdout, branch_err = self._run_cmd(["git", "branch", "--show-current"])
        if branch_err or not branch_stdout:
            branch_stdout = "main"

        _, err = self._run_cmd(["git", "push", "origin", branch_stdout])
        if err:
            self.status = "FAILED"
            self.error_message = f"Git push failed: {err}"
            return

        # Success!
        self.status = "SUCCESS"
        self.last_sync_time = datetime.utcnow()
        self.error_message = None
        self.uncommitted_changes = False
        self.need_push = False

        # Retrieve last commit details
        commit_info, _ = self._run_cmd(["git", "log", "-n", "1", "--format=%s (%h)"])
        if commit_info:
            self.last_commit = commit_info
