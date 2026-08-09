import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "10mb" }));

// API compatibility bridge: the approved UI remains unchanged while its
// legacy-shaped AI calls are served by the Go backend.
const backendURL = (process.env.BACKEND_URL || "http://localhost:8080").replace(/\/$/, "");
app.use("/api/ai", async (req, res, next) => {
  if (req.method !== "POST") return next();
  try {
    const upstream = await fetch(`${backendURL}${req.originalUrl}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body ?? {}),
    });
    const payload = await upstream.text();
    res.status(upstream.status).type("application/json").send(payload);
  } catch (error) {
    next(error);
  }
});

// Initialize Gemini Client
const getGeminiAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not set. AI features will fallback to smart template responses.");
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

// API Routes
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// AI Chat Assistant endpoint
app.post("/api/ai/chat", async (req, res) => {
  try {
    const { message, model = "gemini-3.6-flash", cvData } = req.body;
    const ai = getGeminiAI();

    if (!ai) {
      // Mock fallback if API key not available
      return res.json({
        reply: `Trợ lý AI HR-Agent: Tôi đã nhận được yêu cầu "${message}". Vui lòng kiểm tra lại cấu hình GEMINI_API_KEY để kích hoạt gợi ý thời gian thực từ Gemini. Dưới đây là một số gợi ý mẫu: Thêm số liệu đo lường được (VD: tăng 30% hiệu suất) vào mô tả dự án của bạn!`,
      });
    }

    const systemInstruction = `Bạn là Trợ lý AI nâng cấp CV chuyên nghiệp của hệ thống HR-Agent.
Nhiệm vụ của bạn là giúp ứng viên tối ưu hoá các phần trong CV (Thông tin cá nhân, Kinh nghiệm, Dự án, Kỹ năng, Học vấn, Chứng chỉ, Hoạt động, Ngôn ngữ).
Hãy trả lời bằng tiếng Việt một cách súc tích, ngắn gọn, chuyên nghiệp và có thể áp dụng trực tiếp vào CV.

Dữ liệu CV hiện tại của ứng viên:
${JSON.stringify(cvData || {}, null, 2)}`;

    const response = await ai.models.generateContent({
      model: model || "gemini-3.6-flash",
      contents: message,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    res.json({ reply: response.text || "Đã xử lý xong yêu cầu của bạn." });
  } catch (error: any) {
    console.error("AI Chat Error:", error);
    res.status(500).json({ error: error.message || "Failed to process AI chat" });
  }
});

// AI Quick Action endpoint (Optimize experience, Shorten intro, Check grammar, Rewrite skills, etc.)
app.post("/api/ai/quick-action", async (req, res) => {
  try {
    const { action, cvData, targetSection } = req.body;
    const ai = getGeminiAI();

    if (!ai) {
      return res.json({
        result: "Dựa vào kinh nghiệm AI Engineer của bạn: Đã tối ưu hoá các gạch đầu dòng với chỉ số hiệu năng cụ thể (latency, accuracy, scale).",
      });
    }

    let prompt = "";
    switch (action) {
      case "optimize_experience":
        prompt = `Hãy tối ưu hoá phần Kinh nghiệm làm việc (Experience) trong CV này. Viết lại các gạch đầu dòng theo mô hình STAR (Situation, Task, Action, Result) có kèm con số định lượng cụ thể: ${JSON.stringify(cvData?.experience || [])}`;
        break;
      case "shorten_intro":
        prompt = `Hãy tóm tắt ngắn gọn phần Giới thiệu bản thân (Introduction) trong CV này xuống 2-3 câu ấn tượng nhất: ${JSON.stringify(cvData?.intro || "")}`;
        break;
      case "check_grammar":
        prompt = `Kiểm tra lỗi ngữ pháp, chính tả tiếng Anh và tiếng Việt trong toàn bộ dữ liệu CV sau, chỉ ra lỗi và sửa lại chuẩn xác nhất: ${JSON.stringify(cvData || {})}`;
        break;
      case "rewrite_skills":
        prompt = `Phân loại và sắp xếp lại danh sách Kỹ năng (Skills) theo nhóm chuyên nghiệp (Kỹ năng chuyên môn, Công nghệ core, Soft skills): ${JSON.stringify(cvData?.skills || [])}`;
        break;
      case "generate_summary":
        prompt = `Viết một đoạn Summary / Profile Statement chuẩn phong cách Tech Executive / Lead AI Engineer dựa trên dữ liệu CV này: ${JSON.stringify(cvData || {})}`;
        break;
      case "suggest_improvements":
        prompt = `Đánh giá tổng thể CV này và đưa ra 3 điểm mạnh nổi bật cùng 3 điểm cần bổ sung gấp để nâng cao cơ hội đậu phỏng vấn: ${JSON.stringify(cvData || {})}`;
        break;
      default:
        prompt = `Tối ưu nội dung CV sau: ${JSON.stringify(cvData || {})}`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        systemInstruction: "Bạn là chuyên gia tư vấn tuyển dụng cấp cao (Senior HR Specialist). Trả lời bằng tiếng Việt chuyên nghiệp, ngắn gọn, súc tích.",
      },
    });

    res.json({ result: response.text });
  } catch (error: any) {
    console.error("AI Quick Action Error:", error);
    res.status(500).json({ error: error.message || "Failed to perform quick action" });
  }
});

// Job Description Matcher endpoint
app.post("/api/ai/match-job", async (req, res) => {
  try {
    const { cvData, jobDescription } = req.body;
    const ai = getGeminiAI();

    if (!ai) {
      return res.json({
        matchScore: 85,
        analysis: "CV phù hợp 85% với vị trí AI Engineer / Tech Lead.",
        strengths: ["Kinh nghiệm triển khai MLOps & LLMs", "Sử dụng PyTorch & TensorRT", "Microservices Architecture"],
        missingKeywords: ["Kubernetes (K8s)", "CI/CD Pipeline with GitHub Actions", "GraphQL"],
        recommendations: "Bổ sung dự án thực tế liên quan đến Orchestration K8s và mô tả rõ quy trình CI/CD.",
      });
    }

    const prompt = `So sánh CV của ứng viên với Mô tả công việc (Job Description) sau đây và đưa ra đánh giá chi tiết theo định dạng JSON.

Nội dung CV:
${JSON.stringify(cvData || {}, null, 2)}

Mô tả công việc (Job Description):
${jobDescription}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        systemInstruction: `Bạn là hệ thống ATS (Applicant Tracking System) và chuyên gia nhân sự. 
Hãy phân tích độ tương thích và trả về JSON chuẩn theo cấu trúc sau:
{
  "matchScore": 85, (số từ 0 đến 100)
  "analysis": "Tóm tắt ngắn gọn đánh giá độ phù hợp",
  "strengths": ["Điểm mạnh 1", "Điểm mạnh 2", "Điểm mạnh 3"],
  "missingKeywords": ["Từ khóa thiếu 1", "Từ khóa thiếu 2"],
  "recommendations": "Gợi ý chỉnh sửa CV để khớp hơn"
}`,
      },
    });

    const parsedData = JSON.parse(response.text || "{}");
    res.json(parsedData);
  } catch (error: any) {
    console.error("AI Job Match Error:", error);
    res.status(500).json({ error: error.message || "Failed to match job" });
  }
});

// Vite Development or Static Production Server
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`HR-Agent server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
