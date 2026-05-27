import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, ExternalLink, PlayCircle } from 'lucide-react';
import { useLocalize } from '~/hooks';

const MEDIA_BASE = '/guide-media';
const VIDEO_SRC = `${MEDIA_BASE}/MemodoAI-intro.mp4`;
const CAPTIONS_EN = `${MEDIA_BASE}/transcript.en.vtt`;
const CAPTIONS_DE = `${MEDIA_BASE}/transcript.de.vtt`;
const TRANSCRIPT_SRC = `${MEDIA_BASE}/transcript.en.txt`;
const CHAPTERS_SRC = `${MEDIA_BASE}/chapters.json`;
const WRITTEN_GUIDE_SRC = `${MEDIA_BASE}/getting-started-with-MemodoAI.html`;

type CaptionLang = 'en' | 'de' | 'off';
const CAPTION_OPTIONS: {
  value: CaptionLang;
  key: 'com_ui_guide_captions_en' | 'com_ui_guide_captions_de' | 'com_ui_guide_captions_off';
}[] = [
  { value: 'en', key: 'com_ui_guide_captions_en' },
  { value: 'de', key: 'com_ui_guide_captions_de' },
  { value: 'off', key: 'com_ui_guide_captions_off' },
];

interface GuideChapter {
  index: number;
  start: string;
  start_seconds: number;
  end_seconds: number;
  title: string;
}

interface GuideChaptersFile {
  chapters: GuideChapter[];
}

function formatTimestamp(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Indicates the written guide is available in both English and German (it has an in-page switcher). */
function LanguageBadge() {
  const localize = useLocalize();
  return (
    <span
      className="rounded bg-surface-tertiary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary"
      title={localize('com_ui_guide_written_languages')}
    >
      {localize('com_ui_guide_languages')}
    </span>
  );
}

export default function Guide() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [chapters, setChapters] = useState<GuideChapter[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [videoFailed, setVideoFailed] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [captionLang, setCaptionLang] = useState<CaptionLang>('en');

  const applyCaptionMode = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (track.kind !== 'captions') {
        continue;
      }
      track.mode = captionLang !== 'off' && track.language === captionLang ? 'showing' : 'disabled';
    }
  }, [captionLang]);

  // Re-apply on captionLang change and after the tracks load (onLoadedMetadata),
  // since setting track.mode before the cues load can be overridden by the browser.
  useEffect(() => {
    applyCaptionMode();
  }, [applyCaptionMode, videoFailed]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(CHAPTERS_SRC, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<GuideChaptersFile>) : null))
      .then((data) => {
        if (data?.chapters) {
          setChapters(data.chapters);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!showTranscript || transcript) {
      return;
    }
    const controller = new AbortController();
    fetch(TRANSCRIPT_SRC, { signal: controller.signal })
      .then((res) => (res.ok ? res.text() : ''))
      .then((text) => setTranscript(text))
      .catch(() => undefined);
    return () => controller.abort();
  }, [showTranscript, transcript]);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.currentTime = seconds;
    void video.play().catch(() => undefined);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const current = video.currentTime;
    const index = chapters.findIndex(
      (chapter) => current >= chapter.start_seconds && current < chapter.end_seconds,
    );
    setActiveIndex(index);
  }, [chapters]);

  return (
    <div className="h-screen w-full overflow-y-auto bg-surface-primary">
      <div className="bg-surface-primary/95 sticky top-0 z-10 flex items-center justify-between border-b border-border-light px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => navigate('/c/new')}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {localize('com_ui_guide_back')}
        </button>
        <a
          href={WRITTEN_GUIDE_SRC}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-border-medium px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-secondary"
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          {localize('com_ui_guide_open_written')}
          <LanguageBadge />
          <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </a>
      </div>

      <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-text-primary sm:text-3xl">
            {localize('com_ui_guide_title')}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-text-secondary sm:text-base">
            {localize('com_ui_guide_subtitle')}
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0">
            {videoFailed ? (
              <div className="flex aspect-[16/10] w-full items-center justify-center rounded-xl border border-border-medium bg-surface-secondary p-6 text-center text-sm text-text-secondary">
                {localize('com_ui_guide_video_unavailable')}
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  controls
                  preload="metadata"
                  playsInline
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={applyCaptionMode}
                  onError={() => setVideoFailed(true)}
                  className="aspect-[16/10] w-full rounded-xl border border-border-medium bg-black shadow-sm"
                >
                  <source src={VIDEO_SRC} type="video/mp4" />
                  <track kind="captions" src={CAPTIONS_EN} srcLang="en" label="English" />
                  <track kind="captions" src={CAPTIONS_DE} srcLang="de" label="Deutsch" />
                </video>
                <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
                  <span>{localize('com_ui_guide_captions')}</span>
                  <div className="inline-flex overflow-hidden rounded-md border border-border-medium">
                    {CAPTION_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setCaptionLang(option.value)}
                        aria-pressed={captionLang === option.value}
                        className={`px-2 py-1 font-medium transition-colors ${
                          captionLang === option.value
                            ? 'bg-surface-tertiary text-text-primary'
                            : 'text-text-secondary hover:bg-surface-secondary'
                        }`}
                      >
                        {localize(option.key)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {chapters.length > 0 && (
            <nav aria-label={localize('com_ui_guide_chapters')}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-secondary">
                {localize('com_ui_guide_chapters')}
              </h2>
              <ol className="overflow-hidden rounded-xl border border-border-medium bg-surface-secondary lg:max-h-[70vh] lg:overflow-y-auto">
                {chapters.map((chapter, index) => (
                  <li key={chapter.index}>
                    <button
                      type="button"
                      onClick={() => seekTo(chapter.start_seconds)}
                      aria-current={index === activeIndex ? 'true' : undefined}
                      className={`flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-tertiary ${
                        index === activeIndex
                          ? 'bg-surface-tertiary font-medium text-text-primary'
                          : 'text-text-secondary'
                      }`}
                    >
                      <span className="min-w-[2.75rem] font-mono text-xs tabular-nums text-text-secondary">
                        {formatTimestamp(chapter.start_seconds)}
                      </span>
                      <span>{chapter.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </div>

        <section className="mt-8">
          <button
            type="button"
            onClick={() => setShowTranscript((prev) => !prev)}
            aria-expanded={showTranscript}
            className="inline-flex items-center gap-2 text-lg font-semibold text-text-primary"
          >
            <PlayCircle className="h-5 w-5" aria-hidden="true" />
            {showTranscript
              ? localize('com_ui_guide_hide_transcript')
              : localize('com_ui_guide_show_transcript')}
          </button>
          {showTranscript && (
            <div className="mt-3 max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-border-medium bg-surface-secondary p-4 text-sm leading-relaxed text-text-secondary">
              {transcript || localize('com_ui_guide_transcript')}
            </div>
          )}
        </section>

        <section className="mt-8 rounded-xl border border-border-medium bg-surface-secondary p-5">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-text-primary">
            <BookOpen className="h-5 w-5" aria-hidden="true" />
            {localize('com_ui_guide_written_heading')}
          </h2>
          <p className="mb-3 text-sm text-text-secondary">
            {localize('com_ui_guide_written_subtitle')}
          </p>
          <a
            href={WRITTEN_GUIDE_SRC}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-surface-primary px-4 py-2 text-sm font-medium text-text-primary ring-1 ring-border-medium transition-colors hover:bg-surface-tertiary"
          >
            {localize('com_ui_guide_open_written')}
            <LanguageBadge />
            <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
          </a>
        </section>
      </div>
    </div>
  );
}
