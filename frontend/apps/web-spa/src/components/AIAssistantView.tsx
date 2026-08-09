import React, { useState } from 'react';
import { ChatMessage, CV } from '../types';
import { Bot, Send, Sparkles, User, Mic } from 'lucide-react';

interface AIAssistantViewProps {
  activeCV: CV;
}

export const AIAssistantView: React.FC<AIAssistantViewProps> = ({ activeCV }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'ai',
      text: `Xin chào! Tôi là Trợ lý AI HR-Agent. Tôi có thể giúp bạn tối ưu hóa hồ sơ xin việc (${activeCV.sections.intro.fullName || 'LE THANH HAI'}), chuẩn bị câu hỏi phỏng vấn vị trí ${activeCV.sections.intro.title || 'AI Engineer'}, hoặc gợi ý cách nâng cao mức lương mong muốn. Bạn cần trợ giúp gì hôm nay?`,
      timestamp: 'Vừa xong',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userText = input;
    setInput('');
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: userText,
      timestamp: 'Vừa xong',
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          cvData: activeCV.sections,
        }),
      });
      const data = await res.json();

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: data.reply || 'Đã xử lý xong.',
        timestamp: 'Vừa xong',
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6 animate-fade-in flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex items-center space-x-3 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold shadow-xs">
          <Bot className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Trợ lý AI Nghề nghiệp (HR-Agent AI)
          </h1>
          <p className="text-xs text-slate-500">
            Hỗ trợ bởi mô hình chạy nội bộ — Tư vấn CV, chiến lược phỏng vấn & định hướng sự nghiệp.
          </p>
        </div>
      </div>

      {/* Chat Messages List */}
      <div className="flex-1 overflow-y-auto bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex space-x-3 ${
              m.sender === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            {m.sender === 'ai' && (
              <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 mt-1 border border-indigo-100">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
            )}
            <div
              className={`max-w-[80%] p-3.5 rounded-2xl text-xs md:text-sm leading-relaxed whitespace-pre-line ${
                m.sender === 'user'
                  ? 'bg-indigo-600 text-white font-medium shadow-2xs'
                  : 'bg-slate-50 text-slate-800 border border-slate-200/80'
              }`}
            >
              {m.text}
            </div>
            {m.sender === 'user' && (
              <div className="w-7 h-7 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 mt-1">
                <User className="w-3.5 h-3.5" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center space-x-2 text-xs text-indigo-700 bg-indigo-50 p-3 rounded-xl border border-indigo-100 animate-pulse w-max">
            <Sparkles className="w-3.5 h-3.5 animate-spin" />
            <span>Trợ lý AI đang suy nghĩ...</span>
          </div>
        )}
      </div>

      {/* Input Field */}
      <div className="relative shrink-0">
        <input
          type="text"
          placeholder="Hỏi Trợ lý AI bất kỳ điều gì về CV hoặc phỏng vấn..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          className="w-full pl-4 pr-24 py-3 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-indigo-500 shadow-2xs"
        />
        <div className="absolute right-1.5 top-1.5 flex items-center space-x-1">
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-xs rounded-lg transition flex items-center space-x-1"
          >
            <span>Gửi</span>
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
