import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CV, JobMatchResult } from '../types';
import { GitCompare, Sparkles, CheckCircle, AlertTriangle, ArrowRight, Upload, FileText } from 'lucide-react';

interface JobMatchViewProps {
  cvs: CV[];
}

export const JobMatchView: React.FC<JobMatchViewProps> = ({ cvs }) => {
  const navigate = useNavigate();
  const [selectedCVId, setSelectedCVId] = useState<string>(cvs[0]?.id || '');
  const [jobDescription, setJobDescription] = useState<string>(
    `Tuyển dụng AI Engineer / MLOps Specialist
• Thiết kế và triển khai mô hình Computer Vision & LLMs trên hạ tầng Edge AI (Jetson Nano, Orin).
• Tối ưu hoá mô hình bằng PyTorch, TensorRT, ONNX, vLLM.
• Yêu cầu kinh nghiệm MLOps, Docker, Microservices, Redis, WebSockets.
• Ưu tiên ứng viên có chứng chỉ NVIDIA hoặc kiến thức về RAG & Multi-Agent systems.`
  );

  const [isLoading, setIsLoading] = useState(false);
  const [matchResult, setMatchResult] = useState<JobMatchResult | null>({
    matchScore: 88,
    analysis:
      'CV của bạn cực kỳ phù hợp với vị trí tuyển dụng AI Engineer này, đặc biệt ở phần kinh nghiệm Edge AIoT, MLOps microservices và tối ưu hoá TensorRT.',
    strengths: [
      'Kinh nghiệm thực tế với Jetson Orin Nano, Rockchip và TinyML',
      'Đã xây dựng hệ thống Vision MLOps 11 microservices với Docker, MinIO, Redis',
      'Thành thạo PyTorch, ONNX, TensorRT và Triton Server',
    ],
    missingKeywords: ['Kubernetes (K8s)', 'GraphQL', 'CI/CD GitHub Actions'],
    recommendations:
      'Thêm một số dòng ngắn mô tả kinh nghiệm triển khai CI/CD pipeline tự động hóa build và test mô hình AI.',
  });

  const handleAnalyzeMatch = async () => {
    if (!jobDescription.trim()) return;
    setIsLoading(true);

    const activeCV = cvs.find((c) => c.id === selectedCVId) || cvs[0];

    try {
      const res = await fetch('/api/ai/match-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cvData: activeCV.sections,
          jobDescription,
        }),
      });
      const data = await res.json();
      setMatchResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-8 animate-fade-in">
      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 p-6 rounded-2xl border border-slate-800 text-white shadow-sm">
        <span className="inline-block px-3 py-1 bg-indigo-500/20 border border-indigo-400/30 rounded-full text-[10px] font-semibold text-indigo-300 uppercase mb-1 tracking-wider">
          ĐỐI CHIẾU THÔNG MINH
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-3">
          <GitCompare className="w-6 h-6 text-indigo-400" />
          <span>Đối chiếu việc làm (Job Matching)</span>
        </h1>
        <p className="text-slate-300 font-normal text-xs md:text-sm mt-1">
          So sánh CV của bạn với Mô tả công việc (JD) để đánh giá độ tương thích ATS và nhận gợi ý chỉnh sửa thời gian thực.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              1. Chọn CV để đối chiếu
            </label>
            <select
              value={selectedCVId}
              onChange={(e) => setSelectedCVId(e.target.value)}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500"
            >
              {cvs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.sections.intro.fullName || c.title} - ({c.sections.intro.title})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              2. Dán Mô tả công việc (Job Description)
            </label>
            <textarea
              rows={8}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Dán nội dung tuyển dụng từ Facebook, LinkedIn, ITViec..."
              className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-500 font-mono text-slate-800 leading-relaxed"
            />
          </div>

          <button
            onClick={handleAnalyzeMatch}
            disabled={isLoading || !jobDescription.trim()}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-xs rounded-xl transition shadow-xs flex items-center justify-center space-x-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>{isLoading ? 'Đang phân tích độ khớp...' : 'Phân tích độ tương thích AI'}</span>
          </button>
        </div>

        {/* Match Result Panel */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-6">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            KẾT QUẢ PHÂN TÍCH TƯƠNG THÍCH
          </h3>

          {matchResult ? (
            <div className="space-y-6">
              {/* Score Indicator */}
              <div className="flex items-center space-x-4 p-4 rounded-xl bg-emerald-50/80 border border-emerald-100">
                <div className="w-16 h-16 rounded-xl bg-emerald-600 text-white flex flex-col items-center justify-center font-bold shrink-0 shadow-2xs">
                  <span className="text-xl leading-none">{matchResult.matchScore}%</span>
                  <span className="text-[9px] font-medium opacity-90 uppercase mt-0.5">Tương thích</span>
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">
                    {matchResult.matchScore >= 80
                      ? 'Độ khớp cao — Sẵn sàng nộp!'
                      : 'Độ khớp trung bình — Cần bổ sung từ khóa'}
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {matchResult.analysis}
                  </p>
                </div>
              </div>

              {/* Strengths */}
              <div>
                <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  <span>Điểm mạnh nổi bật trong CV</span>
                </h4>
                <ul className="space-y-1.5 pl-6 list-disc text-xs text-slate-700 font-medium leading-relaxed">
                  {matchResult.strengths.map((str, i) => (
                    <li key={i}>{str}</li>
                  ))}
                </ul>
              </div>

              {/* Missing Keywords */}
              <div>
                <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <span>Từ khóa thiếu (Cần cân nhắc thêm)</span>
                </h4>
                <div className="flex flex-wrap gap-2">
                  {matchResult.missingKeywords.map((kw, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200/80 text-xs font-medium rounded-lg"
                    >
                      + {kw}
                    </span>
                  ))}
                </div>
              </div>

              {/* Recommendation */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
                <span className="text-xs font-semibold text-slate-800 uppercase tracking-wide">
                  GỢI Ý HÀNH ĐỘNG
                </span>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {matchResult.recommendations}
                </p>
                <button
                  onClick={() => navigate(`/builder/${selectedCVId}`)}
                  className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center space-x-1 transition"
                >
                  <span>Chỉnh sửa CV ngay</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400 text-xs">
              Nhấn nút "Phân tích độ tương thích AI" để bắt đầu so sánh CV của bạn với JD.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

