import json
import logging
import requests
import re
from typing import List
from .config import settings

logger = logging.getLogger("gemini_client")

class GeminiClient:
    BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"

    @classmethod
    def _call_gemini(cls, prompt: str, system_instruction: str = None) -> str:
        if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY == "placeholder-gemini-key":
            logger.warning("Gemini API key is not configured. Returning placeholder responses.")
            return "Placeholder response (Gemini API key is missing)"

        url = f"{cls.BASE_URL}?key={settings.GEMINI_API_KEY}"
        headers = {"Content-Type": "application/json"}
        
        contents = {
            "parts": [{"text": prompt}]
        }
        
        payload = {
            "contents": [contents],
        }
        
        if system_instruction:
            payload["systemInstruction"] = {
                "parts": [{"text": system_instruction}]
            }

        try:
            response = requests.post(url, headers=headers, json=payload, timeout=15)
            if response.status_code != 200:
                logger.error(f"Gemini API returned status {response.status_code}: {response.text}")
                return "Fallback response (API error)"
                
            resp_json = response.json()
            candidates = resp_json.get("candidates", [])
            if candidates:
                content = candidates[0].get("content", {})
                parts = content.get("parts", [])
                if parts:
                    return parts[0].get("text", "").strip()
            
            return "Fallback response (Empty candidates)"
        except Exception as e:
            logger.error(f"Exception during Gemini API request: {e}")
            return "Fallback response (Request exception)"

    @classmethod
    def optimize_caption(cls, caption: str) -> str:
        prompt = f"Please optimize this social media caption to make it more engaging, readable, and increase click-through rate. Preserve the core message: {caption}"
        system_instruction = "You are a senior copywriter and social media marketer. Keep the tone professional, creative, and format the output nicely with hooks and a clear call to action."
        return cls._call_gemini(prompt, system_instruction)

    @classmethod
    def suggest_hashtags(cls, caption: str) -> List[str]:
        prompt = f"Suggest 10 trending and highly relevant hashtags for the following caption. Return only the hashtags separated by spaces, no explanations: {caption}"
        system_instruction = "You are a social media growth expert. Output only the hashtags, nothing else."
        res = cls._call_gemini(prompt, system_instruction)
        tags = [t.strip() for t in res.split() if t.startswith("#")]
        if not tags:
            tags = ["#socialmedia", "#marketing", "#instagram"]
        return tags

    @classmethod
    def suggest_emojis(cls, caption: str) -> List[str]:
        prompt = f"Suggest 5-10 expressive emojis that match the tone and topic of the following caption. Return only the emojis without spaces or explanations: {caption}"
        system_instruction = "You are an emoji coordinator. Output only the emojis, nothing else."
        res = cls._call_gemini(prompt, system_instruction)
        emojis = [c for c in res if not c.isalnum() and not c.isspace()]
        if not emojis:
            emojis = ["🔥", "✨", "🚀", "📷"]
        return emojis[:15]

    @classmethod
    def translate_caption(cls, caption: str, target_lang: str) -> str:
        prompt = f"Translate the following social media caption into {target_lang}. Preserve formatting and hashtags: {caption}"
        system_instruction = "You are an expert translator. Output only the translated caption."
        return cls._call_gemini(prompt, system_instruction)

    @classmethod
    def calculate_quality_score(cls, caption: str) -> int:
        prompt = f"Evaluate the readability, engagement, and hook effectiveness of the following social media caption. Return only a single integer between 0 and 100 representing the overall quality score, no explanation: {caption}"
        system_instruction = "You are an expert copywriter auditor. Output only a single number between 0 and 100, nothing else."
        res = cls._call_gemini(prompt, system_instruction)
        try:
            match = re.search(r'\d+', res)
            if match:
                score = int(match.group(0))
                return min(100, max(0, score))
            return 80
        except Exception:
            return 80
