import React, { useState } from 'react';
import { initialCVs } from './mockData';
import { CV, ViewTab } from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { MyCVsView } from './components/MyCVsView';
import { CVEditorView } from './components/CVEditorView';
import { JobMatchView } from './components/JobMatchView';
import { AIAssistantView } from './components/AIAssistantView';
import { TemplatesView } from './components/TemplatesView';
import { SettingsView } from './components/SettingsView';
import { UploadModal } from './components/UploadModal';
import { ShareModal } from './components/ShareModal';
import { PreviewModal } from './components/PreviewModal';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewTab>('dashboard');
  const [cvs, setCvs] = useState<CV[]>(initialCVs);
  const [activeCVId, setActiveCVId] = useState<string>(initialCVs[0]?.id || 'cv-1');

  // Modals state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);

  // Active CV object
  const activeCV = cvs.find((c) => c.id === activeCVId) || cvs[0];

  // Navigation handler
  const handleNavigate = (view: ViewTab) => {
    setCurrentView(view);
  };

  // Open CV Editor
  const handleSelectCVToEdit = (cvId: string) => {
    setActiveCVId(cvId);
    setCurrentView('editor');
  };

  // Create new manual CV
  const handleCreateNewCV = () => {
    const newId = `cv-${Date.now()}`;
    const newCV: CV = {
      id: newId,
      title: 'CV mới chưa đặt tên',
      lastModified: 'Vừa tạo',
      design: {
        template: 'modern',
        accentColor: '#00897B',
        font: 'Open Sans',
        fontSize: 14,
        spacing: 'condensed',
      },
      activeSections: {
        intro: true,
        experience: true,
        projects: true,
        education: true,
        skills: true,
        activities: true,
        certifications: true,
        languages: true,
      },
      sections: {
        intro: {
          fullName: 'HỌ VÀ TÊN ỨNG VIÊN',
          title: 'Vị trí công việc',
          email: 'email@example.com',
          phone: '0901234567',
          location: 'Hồ Chí Minh, Việt Nam',
          summary: 'Mô tả ngắn gọn về kinh nghiệm, mục tiêu nghề nghiệp và thế mạnh nổi bật của bạn.',
        },
        experience: [],
        projects: [],
        education: [],
        skills: [],
        activities: [],
        certifications: [],
        languages: [],
      },
    };

    setCvs([newCV, ...cvs]);
    setActiveCVId(newId);
    setCurrentView('editor');
  };

  // Delete CV
  const handleDeleteCV = (cvId: string) => {
    const updated = cvs.filter((c) => c.id !== cvId);
    setCvs(updated);
    if (activeCVId === cvId && updated.length > 0) {
      setActiveCVId(updated[0].id);
    }
  };

  // Update existing CV
  const handleUpdateCV = (updatedCV: CV) => {
    setCvs(cvs.map((c) => (c.id === updatedCV.id ? updatedCV : c)));
  };

  // Upload handler
  const handleUploadSuccess = (title: string) => {
    const newId = `cv-${Date.now()}`;
    const uploadedCV: CV = {
      ...initialCVs[0],
      id: newId,
      title: title,
      sections: {
        ...initialCVs[0].sections,
        intro: {
          ...initialCVs[0].sections.intro,
          fullName: title.toUpperCase(),
        },
      },
      lastModified: 'Vừa tải lên',
    };
    setCvs([uploadedCV, ...cvs]);
    setActiveCVId(newId);
    setCurrentView('editor');
  };

  // Select Template handler
  const handleSelectTemplate = (templateName: 'modern' | 'classic' | 'professional') => {
    if (activeCV) {
      handleUpdateCV({
        ...activeCV,
        design: {
          ...activeCV.design,
          template: templateName,
        },
      });
    }
    setCurrentView('editor');
  };

  // PDF Export / Print
  const handleDownloadPDF = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-gray-900 antialiased selection:bg-violet-100 selection:text-violet-900">
      {/* Top Header */}
      <Header
        currentView={currentView}
        onNavigate={handleNavigate}
        userEmail="tester@example.com"
        onOpenPreview={() => setIsPreviewModalOpen(true)}
        onOpenShare={() => setIsShareModalOpen(true)}
        onDownloadPDF={handleDownloadPDF}
        onOpenUpload={() => setIsUploadModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Navigation Sidebar (Hidden in Editor view if on small screens) */}
        {currentView !== 'editor' && (
          <Sidebar currentView={currentView} onNavigate={handleNavigate} />
        )}

        {/* Dynamic View Component */}
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          {currentView === 'dashboard' && (
            <DashboardView
              cvs={cvs}
              onNavigate={handleNavigate}
              onSelectCVToEdit={handleSelectCVToEdit}
              onOpenUploadModal={() => setIsUploadModalOpen(true)}
              userEmail="tester@example.com"
            />
          )}

          {currentView === 'my_cvs' && (
            <MyCVsView
              cvs={cvs}
              onSelectCVToEdit={handleSelectCVToEdit}
              onCreateNewCV={handleCreateNewCV}
              onOpenUploadModal={() => setIsUploadModalOpen(true)}
              onDeleteCV={handleDeleteCV}
            />
          )}

          {currentView === 'editor' && activeCV && (
            <CVEditorView
              cv={activeCV}
              onUpdateCV={handleUpdateCV}
              onOpenPreview={() => setIsPreviewModalOpen(true)}
              onOpenShare={() => setIsShareModalOpen(true)}
              onDownloadPDF={handleDownloadPDF}
            />
          )}

          {currentView === 'job_match' && (
            <JobMatchView cvs={cvs} onSelectCVToEdit={handleSelectCVToEdit} />
          )}

          {currentView === 'ai_assistant' && (
            <AIAssistantView activeCV={activeCV} />
          )}

          {currentView === 'templates' && (
            <TemplatesView onSelectTemplate={handleSelectTemplate} />
          )}

          {currentView === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* Modals */}
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploadSuccess={handleUploadSuccess}
      />

      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        cvTitle={activeCV?.sections.intro.fullName || 'LE THANH HAI'}
      />

      {activeCV && (
        <PreviewModal
          isOpen={isPreviewModalOpen}
          onClose={() => setIsPreviewModalOpen(false)}
          cv={activeCV}
          onDownloadPDF={handleDownloadPDF}
        />
      )}
    </div>
  );
}
