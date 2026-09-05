"""LLM 层：把 provider 配置（主进程解密后传入）映射为 LangChain 聊天模型。

支持的 provider type：
- openai_compat : OpenAI 兼容接口（DeepSeek / GPT / Kimi / GLM / 自建中转）
- anthropic     : Claude 系
- gemini        : Google Gemini 系
- mock          : 本地脚本模型（无 key 闭环测试用）
"""

from __future__ import annotations

from typing import Any, List, Optional

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult


def build_model(provider: dict, effort: str = "off"):
    """provider: {type, baseUrl, model, apiKey}；effort: off|low|medium|high"""
    ptype = provider.get("type", "openai_compat")
    model_name = provider.get("model", "")
    api_key = provider.get("apiKey", "")
    base_url = provider.get("baseUrl") or None

    if ptype == "mock":
        return MockChatModel()

    if ptype == "openai_compat":
        from langchain_openai import ChatOpenAI

        kwargs: dict[str, Any] = {
            "model": model_name,
            "api_key": api_key,
            "streaming": True,
            "timeout": 300,
        }
        if base_url:
            kwargs["base_url"] = base_url
        # 推理等级：仅对确认支持 reasoning.effort 的端点透传（DeepSeek 等用模型名区分，乱传会报错）
        if effort != "off" and base_url and "api.openai.com" in base_url:
            kwargs["model_kwargs"] = {"reasoning_effort": effort}
        return ChatOpenAI(**kwargs)

    if ptype == "anthropic":
        from langchain_anthropic import ChatAnthropic

        kwargs = {
            "model": model_name,
            "api_key": api_key,
            "max_tokens": 8192,
            "timeout": 300,
        }
        if base_url and "api.anthropic.com" not in base_url:
            kwargs["base_url"] = base_url
        # 扩展思考：low/medium/high 映射到思考预算
        budgets = {"low": 4096, "medium": 8192, "high": 16384}
        if effort in budgets:
            kwargs["max_tokens"] = budgets[effort] + 8192
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": budgets[effort]}
        return ChatAnthropic(**kwargs)

    if ptype == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(
            model=model_name,
            google_api_key=api_key,
            timeout=300,
        )

    raise ValueError(f"未知的 provider 类型：{ptype}")


class MockChatModel(BaseChatModel):
    """测试用脚本模型：第一次调用发起 file_create 工具调用，之后返回固定文本。"""

    calls: int = 0

    @property
    def _llm_type(self) -> str:
        return "mock"

    def bind_tools(self, tools: Any, **kwargs: Any) -> "MockChatModel":
        return self

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        self.calls += 1
        if self.calls % 2 == 1:  # 每轮对话的第一步发起工具调用，第二步收尾
            message = AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "file_create",
                        "args": {"path": "workspace/notes/mock.txt", "content": "mock 写入测试"},
                        "id": "call_mock_1",
                        "type": "tool_call",
                    }
                ],
            )
        else:
            message = AIMessage(content="mock 测试完成：文件已创建。")
        return ChatResult(generations=[ChatGeneration(message=message)])
