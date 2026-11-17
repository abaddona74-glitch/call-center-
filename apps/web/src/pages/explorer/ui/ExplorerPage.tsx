import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SkipToast, StudioPlayer } from '@/widgets/audio-player';
import { EqualizerGlyph } from '@/shared/ui/legacy-icon';
import { ExplorerBrowser } from './ExplorerBrowser';
import './explorer.css';

/** "Audio Explorer" (legacy /explorer): monitor folder browser + Studio player. */
export function ExplorerPage() {
  const { t } = useTranslation('recording');
  const playerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Audio Explorer | Call Center';
    return () => {
      document.title = prev;
    };
  }, []);

  const revealPlayer = () => {
    setTimeout(() => playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  };

  return (
    <div className="mx-auto w-full animate-[ccPageFadeIn_0.3s_ease-in-out]">
      <div className="mb-6 rounded-2xl border border-white/8 bg-[#131d31] p-[22px]">
        <h3 className="inline-flex items-center gap-2 text-base font-semibold text-[#f8fafc]">
          <EqualizerGlyph />
          <span>{t('title')}</span>
        </h3>
      </div>
      <StudioPlayer ref={playerRef} />
      <div className="min-w-0 rounded-2xl border border-white/8 bg-[#131d31] p-[22px]">
        <ExplorerBrowser onPlay={revealPlayer} />
      </div>
      <SkipToast />
    </div>
  );
}
