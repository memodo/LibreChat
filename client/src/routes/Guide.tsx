import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, ExternalLink, PlayCircle } from 'lucide-react';
import { useLocalize } from '~/hooks';

const MEDIA_BASE = '/guide-media';

type VideoLang = 'en' | 'de';
type CaptionLang = VideoLang | 'off';

interface GuideDef {
  id: string;
  titleKey: string;
  subtitleKey: string;
  tabKey: string;
  video: string;
  captions: Partial<Record<VideoLang, string>>;
  transcripts: Partial<Record<VideoLang, string>>;
  chapters: string;
  written: string;
}

/**
 * The guides served at /guide. Each entry is a self-contained set of media paths under
 * /guide-media (served by the backend from a bind-mounted dir, not git). Getting Started
 * keeps the flat root layout it has always had; newer recordings live in a subfolder.
 */
const GUIDES: GuideDef[] = [
  {
    id: 'getting-started',
    titleKey: 'com_ui_guide_title',
    subtitleKey: 'com_ui_guide_subtitle',
    tabKey: 'com_ui_guide_tab_getting_started',
    video: `${MEDIA_BASE}/MemodoAI-intro.mp4`,
    captions: { en: `${MEDIA_BASE}/transcript.en.vtt`, de: `${MEDIA_BASE}/transcript.de.vtt` },
    transcripts: { en: `${MEDIA_BASE}/transcript.en.txt`, de: `${MEDIA_BASE}/transcript.de.txt` },
    chapters: `${MEDIA_BASE}/chapters.json`,
    written: `${MEDIA_BASE}/getting-started-with-MemodoAI.html`,
  },
  {
    id: 'updates-2026-07',
    titleKey: 'com_ui_guide_july2026_title',
    subtitleKey: 'com_ui_guide_july2026_subtitle',
    tabKey: 'com_ui_guide_tab_july2026',
    video: `${MEDIA_BASE}/updates-2026-07/july-2026-updates.mp4`,
    captions: {
      en: `${MEDIA_BASE}/updates-2026-07/transcript.en.vtt`,
      de: `${MEDIA_BASE}/updates-2026-07/transcript.de.vtt`,
    },
    transcripts: {
      en: `${MEDIA_BASE}/updates-2026-07/transcript.en.txt`,
      de: `${MEDIA_BASE}/updates-2026-07/transcript.de.txt`,
    },
    chapters: `${MEDIA_BASE}/updates-2026-07/chapters.json`,
    written: `${MEDIA_BASE}/updates-2026-07/july-2026-updates.html`,
  },
];

/**
 * Query-string key for deep-linking a specific guide, e.g. `/guide?guide=updates-2026-07`.
 * Absent or unknown values fall back to the first (Getting Started) guide, so `/guide` is unchanged.
 */
const GUIDE_PARAM = 'guide';

const resolveGuideId = (id: string | null): string =>
  GUIDES.some((g) => g.id === id) ? (id as string) : GUIDES[0].id;

const VIDEO_LANG_LABEL_KEY: Record<VideoLang, 'com_ui_guide_captions_en' | 'com_ui_guide_captions_de'> =
  {
    en: 'com_ui_guide_captions_en',
    de: 'com_ui_guide_captions_de',
  };

const VIDEO_LANG_TRACK_LABEL: Record<VideoLang, string> = {
  en: 'English',
  de: 'Deutsch',
};

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

function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border-medium">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`px-2 py-1 text-xs font-medium transition-colors ${
            value === option.value
              ? 'bg-surface-tertiary text-text-primary'
              : 'text-text-secondary hover:bg-surface-secondary'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
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
  const [searchParams, setSearchParams] = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeGuideId, setActiveGuideId] = useState<string>(() =>
    resolveGuideId(searchParams.get(GUIDE_PARAM)),
  );
  const [chapters, setChapters] = useState<GuideChapter[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [videoFailed, setVideoFailed] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [transcriptLang, setTranscriptLang] = useState<VideoLang>('en');
  const [captionLang, setCaptionLang] = useState<CaptionLang>('en');

  const guide = useMemo(
    () => GUIDES.find((g) => g.id === activeGuideId) ?? GUIDES[0],
    [activeGuideId],
  );

  const captionLangs = useMemo(() => Object.keys(guide.captions) as VideoLang[], [guide]);
  const transcriptLangs = useMemo(() => Object.keys(guide.transcripts) as VideoLang[], [guide]);

  const applyGuide = useCallback((id: string) => {
    setActiveGuideId(id);
    setChapters([]);
    setActiveIndex(-1);
    setShowTranscript(false);
    setTranscript('');
    setTranscriptLang('en');
    setCaptionLang('en');
    setVideoFailed(false);
  }, []);

  const selectGuide = useCallback(
    (id: string) => {
      if (id === activeGuideId) {
        return;
      }
      applyGuide(id);
      const next = new URLSearchParams(searchParams);
      if (id === GUIDES[0].id) {
        next.delete(GUIDE_PARAM);
      } else {
        next.set(GUIDE_PARAM, id);
      }
      setSearchParams(next, { replace: true });
    },
    [activeGuideId, applyGuide, searchParams, setSearchParams],
  );

  // Deep link: keep the active guide in sync with the ?guide= param, so a shared
  // /guide?guide=<id> URL — or browser back/forward — selects the right guide.
  const guideParam = searchParams.get(GUIDE_PARAM);
  useEffect(() => {
    const target = resolveGuideId(guideParam);
    if (target !== activeGuideId) {
      applyGuide(target);
    }
  }, [guideParam, activeGuideId, applyGuide]);

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
    fetch(guide.chapters, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<GuideChaptersFile>) : null))
      .then((data) => {
        if (data?.chapters) {
          setChapters(data.chapters);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [guide.chapters]);

  useEffect(() => {
    if (!showTranscript) {
      return;
    }
    const src = guide.transcripts[transcriptLang] ?? guide.transcripts.en;
    if (!src) {
      return;
    }
    const controller = new AbortController();
    fetch(src, { signal: controller.signal })
      .then((res) => (res.ok ? res.text() : ''))
      .then((text) => setTranscript(text))
      .catch(() => undefined);
    return () => controller.abort();
  }, [showTranscript, transcriptLang, guide]);

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

  const captionOptions = [
    ...captionLangs.map((lang) => ({ value: lang, label: localize(VIDEO_LANG_LABEL_KEY[lang]) })),
    { value: 'off' as CaptionLang, label: localize('com_ui_guide_captions_off') },
  ];

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
          href={guide.written}
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
        <div
          role="tablist"
          aria-label={localize('com_ui_guide_tabs')}
          className="mb-6 inline-flex gap-1 rounded-lg border border-border-medium bg-surface-secondary p-1"
        >
          {GUIDES.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={g.id === activeGuideId}
              onClick={() => selectGuide(g.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                g.id === activeGuideId
                  ? 'bg-surface-primary text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {localize(g.tabKey)}
            </button>
          ))}
        </div>

        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-text-primary sm:text-3xl">
            {localize(guide.titleKey)}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-text-secondary sm:text-base">
            {localize(guide.subtitleKey)}
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
                  key={guide.id}
                  ref={videoRef}
                  controls
                  preload="metadata"
                  playsInline
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={applyCaptionMode}
                  onError={() => setVideoFailed(true)}
                  className="aspect-[16/10] w-full rounded-xl border border-border-medium bg-black shadow-sm"
                >
                  <source src={guide.video} type="video/mp4" />
                  {(Object.entries(guide.captions) as [VideoLang, string][]).map(([lang, src]) => (
                    <track
                      key={lang}
                      kind="captions"
                      src={src}
                      srcLang={lang}
                      label={VIDEO_LANG_TRACK_LABEL[lang]}
                    />
                  ))}
                </video>
                {captionLangs.length > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
                    <span>{localize('com_ui_guide_captions')}</span>
                    <SegmentedToggle
                      value={captionLang}
                      onChange={setCaptionLang}
                      options={captionOptions}
                    />
                  </div>
                )}
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
          <div className="flex flex-wrap items-center gap-3">
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
            {showTranscript && transcriptLangs.length > 1 && (
              <SegmentedToggle
                value={transcriptLang}
                onChange={setTranscriptLang}
                options={transcriptLangs.map((lang) => ({
                  value: lang,
                  label: localize(VIDEO_LANG_LABEL_KEY[lang]),
                }))}
              />
            )}
          </div>
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
            href={guide.written}
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
