import os
import yaml
from typing import Dict, Any, List
from crewai import Agent, Task, Crew, Process
from langchain_openai import ChatOpenAI

from ..config import settings
from .tools import publish_to_instagram, audit_log

class InstagramPublishingCrew:
    def __init__(self):
        self.agents_config = self._load_yaml("agents.yaml")
        self.tasks_config = self._load_yaml("tasks.yaml")
        
        # Initialize the LLM (OpenAI Chat model)
        self.llm = ChatOpenAI(
            model=settings.OPENAI_MODEL_NAME,
            openai_api_key=settings.OPENAI_API_KEY
        )

    def _load_yaml(self, filename: str) -> Dict[str, Any]:
        """Loads a YAML configuration file relative to this script."""
        current_dir = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(current_dir, filename)
        with open(path, "r", encoding="utf-8") as file:
            return yaml.safe_load(file)

    def build_crew(self, post_id: int, is_video: bool) -> Crew:
        """
        Builds the agents, tasks, and Crew instance dynamically.
        Injects specific tool arguments where needed.
        """
        
        # 1. Instantiate Agents
        admin_agent = Agent(
            config=self.agents_config["admin_agent"],
            llm=self.llm,
            tools=[audit_log],
            verbose=True
        )

        content_agent = Agent(
            config=self.agents_config["content_agent"],
            llm=self.llm,
            tools=[],
            verbose=True
        )

        publishing_agent = Agent(
            config=self.agents_config["publishing_agent"],
            llm=self.llm,
            tools=[publish_to_instagram],
            verbose=True
        )

        monitoring_agent = Agent(
            config=self.agents_config["monitoring_agent"],
            llm=self.llm,
            tools=[audit_log],
            verbose=True
        )

        # 2. Instantiate Tasks
        # We manually map configurations to tasks and link them.
        
        task_1 = Task(
            config=self.tasks_config["validate_and_optimize_content_task"],
            agent=content_agent
        )

        task_2 = Task(
            config=self.tasks_config["verify_accounts_status_task"],
            agent=admin_agent
        )

        # In publish_content_task, the agent must invoke the InstagramPublishTool.
        # We clarify how the tool should be invoked by appending instructions.
        publish_task_config = self.tasks_config["publish_content_task"].copy()
        publish_task_config["description"] += f"\n\nCRITICAL INSTRUCTIONS: You MUST invoke the 'InstagramPublishTool' for each account. Use the following arguments for EACH call:\n- username: the account username\n- password: the decrypted access token / credentials\n- post_id: {post_id}\n- account_id: the numerical account ID\n- caption: the optimized caption from the Content Optimizer\n- media_path: the media_path input variable\n- is_video: {is_video}"
        
        task_3 = Task(
            config=publish_task_config,
            agent=publishing_agent
        )

        task_4 = Task(
            config=self.tasks_config["monitor_and_log_task"],
            agent=monitoring_agent
        )

        # 3. Create the Crew
        # Using sequential process since Content Agent -> Admin Agent -> Publishing Agent -> Monitoring Agent
        return Crew(
            agents=[admin_agent, content_agent, publishing_agent, monitoring_agent],
            tasks=[task_1, task_2, task_3, task_4],
            process=Process.sequential,
            verbose=True
        )

    def kickoff(self, post_id: int, caption: str, hashtags: str, media_path: str, accounts_info: List[Dict[str, Any]], is_video: bool) -> str:
        """
        Kicks off the crew workflow.
        
        Arguments:
            post_id: The primary key of the post
            caption: User-entered raw caption
            hashtags: User-entered raw hashtags
            media_path: Local media path
            accounts_info: A list of dicts like [{"id": 1, "username": "account1"}]
            is_video: Whether the media file is a video
        """
        crew_instance = self.build_crew(post_id=post_id, is_video=is_video)
        
        # Prepare inputs dictionary
        inputs = {
            "caption": caption,
            "hashtags": hashtags,
            "media_path": media_path,
            "accounts_info": str(accounts_info)  # Serialize list of dicts for LLM comprehension
        }
        
        # Execute crew execution
        result = crew_instance.kickoff(inputs=inputs)
        return str(result)
