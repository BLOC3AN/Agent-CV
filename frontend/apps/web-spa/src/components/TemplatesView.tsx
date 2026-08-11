import React from 'react';
import { useLocale } from '../lib/i18n';
import { useNavigate } from 'react-router-dom';
import { Layout, Sparkles } from 'lucide-react';
import { CV } from '../types';

interface TemplatesViewProps {
  cvs: CV[];
}

export const TemplatesView: React.FC<TemplatesViewProps> = ({ cvs }) => {
  const { t } = useLocale()
  const navigate = useNavigate();
  const templates = [
    {
      id: 'modern' as const,
      title: t('templateModern'),
      tag: t('templateModernBadge'),
      desc: t('templateModernHint'),
      badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    },
    {
      id: 'classic' as const,
      title: t('templateClassic'),
      tag: t('templateClassicBadge'),
      desc: t('templateClassicHint'),
      badgeColor: 'bg-slate-100 text-slate-700 border-slate-200',
    },
    {
      id: 'professional' as const,
      title: t('templateProfessional'),
      tag: 'Senior & Manager',
      desc: t('templateProfessionalHint'),
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    },
  ];

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-8 animate-fade-in">
      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 p-6 rounded-2xl border border-slate-800 text-white shadow-sm">
        <span className="inline-block px-3 py-1 bg-indigo-500/20 border border-indigo-400/30 rounded-full text-[10px] font-semibold text-indigo-300 uppercase mb-1 tracking-wider">{t('templateLibrary')}</span>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-3">
          <Layout className="w-6 h-6 text-indigo-400" />
          <span>{t('templatesTitle')}</span>
        </h1>
        <p className="text-slate-300 font-normal text-xs md:text-sm mt-1">{t('templatesHint')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {templates.map((tpl) => (
          <div
            key={tpl.id}
            className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-xs hover:border-indigo-300 hover:shadow-md transition flex flex-col justify-between group"
          >
            <div>
              <div className="p-6 pb-4 border-b border-slate-100">
                <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-semibold border ${tpl.badgeColor} mb-2`}>
                  {tpl.tag}
                </span>
                <h3 className="text-lg font-bold text-slate-900">
                  {tpl.title}
                </h3>
              </div>
              <div className="p-6">
                <p className="text-xs text-slate-600 leading-relaxed">{tpl.desc}</p>
              </div>
            </div>

            <div className="p-6 pt-0">
              <button
                onClick={() => navigate(`/builder/${cvs[0]?.id ?? ''}?template=${tpl.id}`)}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl transition shadow-xs flex items-center justify-center space-x-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>{t('useTemplate')}</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

