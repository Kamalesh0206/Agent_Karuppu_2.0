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
        content_optimizer = Agent(
            config=self.agents_config["content_optimizer"],
            llm=self.llm,
            tools=[],
            verbose=True
        )

        instagram_publisher = Agent(
            config=self.agents_config["instagram_publisher"],
            llm=self.llm,
            tools=[publish_to_instagram],
            verbose=True
        )

        operations_auditor = Agent(
            config=self.agents_config["operations_auditor"],
            llm=self.llm,
            tools=[audit_log],
            verbose=True
        )

        notification_agent = Agent(
            config=self.agents_config["notification_agent"],
            llm=self.llm,
            tools=[],
            verbose=True
        )

        # 2. Instantiate Tasks
        task_1 = Task(
            config=self.tasks_config["validate_and_optimize_content_task"],
            agent=content_optimizer
        )

        publish_task_config = self.tasks_config["publish_content_task"].copy()
        publish_task_config["description"] += (
            f"\n\nCRITICAL INSTRUCTIONS: You MUST invoke the 'InstagramPublishTool' for the account. "
            f"Use the following arguments:\n"
            f"- username: the account username\n"
            f"- access_token: the decrypted access token\n"
            f"- post_id: {post_id}\n"
            f"- account_id: the numerical account ID\n"
            f"- caption: the optimized caption\n"
            f"- media_path: the media_path input variable\n"
            f"- is_video: {is_video}"
        )
        
        task_2 = Task(
            config=publish_task_config,
            agent=instagram_publisher
        )

        task_3 = Task(
            config=self.tasks_config["monitor_and_log_task"],
            agent=operations_auditor
        )

        task_4 = Task(
            config=self.tasks_config["notify_completion_task"],
            agent=notification_agent
        )

        # 3. Create the Crew
        return Crew(
            agents=[content_optimizer, instagram_publisher, operations_auditor, notification_agent],
            tasks=[task_1, task_2, task_3, task_4],
            process=Process.sequential,
            verbose=True
        )

    def kickoff(self, post_id: int, caption: str, hashtags: str, media_path: str, account_info: Dict[str, Any], is_video: bool) -> str:
        """
        Kicks off the crew workflow.
        """
        crew_instance = self.build_crew(post_id=post_id, is_video=is_video)
        
        # Prepare inputs dictionary
        inputs = {
            "caption": caption,
            "hashtags": hashtags,
            "media_path": media_path,
            "account_info": str(account_info)
        }
        
        # Execute crew execution
        result = crew_instance.kickoff(inputs=inputs)
        return str(result)
