import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from 'test/layout-test-utils';
import Guide from '../Guide';

const chaptersFixture = {
  chapters: [
    {
      index: 1,
      start: '00:00:00',
      start_seconds: 0,
      end_seconds: 78,
      title: 'Welcome to MemodoAI',
    },
    {
      index: 2,
      start: '00:01:18',
      start_seconds: 78,
      end_seconds: 143,
      title: 'The interface tour',
    },
  ],
};

const transcriptFixture = 'Welcome to MemodoAI. This is the transcript body.';
const transcriptDeFixture = 'Willkommen bei MemodoAI. Das ist der deutsche Transkript-Text.';

function mockFetch() {
  return jest.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/chapters.json')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(chaptersFixture),
      } as Response);
    }
    if (url.endsWith('transcript.de.txt')) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(transcriptDeFixture),
      } as Response);
    }
    if (url.endsWith('transcript.en.txt')) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(transcriptFixture),
      } as Response);
    }
    return Promise.resolve({ ok: false } as Response);
  });
}

describe('Guide page', () => {
  let playSpy: jest.SpyInstance;

  // The jest config sets restoreMocks: true, so spies must be re-installed per test.
  beforeEach(() => {
    playSpy = jest
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    // jsdom has no media engine: its currentTime setter throws "Not implemented".
    // Make it a plain stored value so seek behavior is observable.
    Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() {
        return this._currentTime ?? 0;
      },
      set(value: number) {
        this._currentTime = value;
      },
    });
    // Tab clicks write ?guide= to the URL; reset between tests so they stay order-independent.
    window.history.replaceState({}, '', '/guide');
  });

  it('renders the title, video, and chapter list from chapters.json', async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    const { container } = render(<Guide />);

    expect(screen.getByText('Getting started with MemodoAI')).toBeInTheDocument();
    expect(container.querySelector('video')).toBeInTheDocument();

    expect(await screen.findByText('Welcome to MemodoAI')).toBeInTheDocument();
    expect(screen.getByText('The interface tour')).toBeInTheDocument();
    expect(screen.getByText('0:00')).toBeInTheDocument();
    expect(screen.getByText('1:18')).toBeInTheDocument();
  });

  it('links to the written HTML guide', () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    render(<Guide />);

    const links = screen.getAllByText('Open the written guide');
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].closest('a')).toHaveAttribute(
      'href',
      '/guide-media/getting-started-with-MemodoAI.html',
    );
  });

  it('seeks the video when a chapter is clicked', async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    const { container } = render(<Guide />);

    const secondChapter = await screen.findByText('The interface tour');
    await userEvent.click(secondChapter);

    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video.currentTime).toBe(78);
    expect(playSpy).toHaveBeenCalled();
  });

  it('lazily loads and shows the transcript on toggle', async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    render(<Guide />);

    await userEvent.click(screen.getByText('Show transcript'));
    expect(await screen.findByText(transcriptFixture)).toBeInTheDocument();
  });

  it('switches the transcript to German', async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    render(<Guide />);

    await userEvent.click(screen.getByText('Show transcript'));
    expect(await screen.findByText(transcriptFixture)).toBeInTheDocument();

    // Two "DE" toggles exist (captions + transcript); the transcript one is last in the DOM.
    const deButtons = screen.getAllByText('DE');
    await userEvent.click(deButtons[deButtons.length - 1]);
    expect(await screen.findByText(transcriptDeFixture)).toBeInTheDocument();
  });

  it('switches to the July 2026 guide via the tab', async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    render(<Guide />);

    // Default is Getting Started.
    expect(screen.getByText('Getting started with MemodoAI')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: "What's New (July 2026)" }));

    expect(screen.getByText('What\'s New in MemodoAI (July 2026)')).toBeInTheDocument();
    const links = screen.getAllByText('Open the written guide');
    expect(links[0].closest('a')).toHaveAttribute(
      'href',
      '/guide-media/updates-2026-07/july-2026-updates.html',
    );
  });

  it('preselects the July 2026 guide from a ?guide= deep link', async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    window.history.replaceState({}, '', '/guide?guide=updates-2026-07');
    render(<Guide />);

    expect(await screen.findByText("What's New in MemodoAI (July 2026)")).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: "What's New (July 2026)" })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Getting Started' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('falls back to Getting Started for an unknown ?guide= value', () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    window.history.replaceState({}, '', '/guide?guide=does-not-exist');
    render(<Guide />);

    expect(screen.getByText('Getting started with MemodoAI')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Getting Started' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
