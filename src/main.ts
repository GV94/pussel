import './style.css';
import { lang, setLang, t, type StringKey } from './i18n';
import { fromFile, loadImage, OfflineError, onlyStored, searchTopic, TOPICS, type PuzzleImage, type Topic } from './images';
import { chooseGrid } from './puzzle/geometry';
import { PuzzleGame } from './puzzle/game';
import { addRecent, clearGame, loadGame, recentImages, saveGame, setSound, soundOn, type SavedGame } from './storage';
import { playFinish } from './sound';

const app = document.getElementById('app')!;

// iPad: stop pinch-zoom and double-tap zoom of the page itself.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.documentElement.lang = lang();

// ------------------------------------------------------------------ tiny DOM helper

type Props = Record<string, unknown> & { class?: string; onClick?: (e: MouseEvent) => void };

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'onClick') el.addEventListener('click', v as EventListener);
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

function icon(name: 'back' | 'eye' | 'guide' | 'gather' | 'photo' | 'refresh' | 'sound' | 'mute'): SVGSVGElement {
  const paths: Record<string, string> = {
    back: 'M15 5 8 12l7 7',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    guide: 'M4 4h16v16H4zM4 12h16M12 4v16',
    gather: 'M4 7h16M4 12h16M4 17h10',
    photo: 'M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
    sound: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
    mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', paths[name]);
  svg.append(p);
  return svg;
}

// ------------------------------------------------------------------ home screen

let currentTopic: Topic = TOPICS.find((t) => t.id === 'samples')!;
const galleryCache = new Map<string, PuzzleImage[]>();
let galleryAbort: AbortController | null = null;

function showHome(): void {
  wakeLock(false);
  app.replaceChildren();
  const saved = loadGame();

  const langButton = (l: 'sv' | 'en', label: string) =>
    h('button', {
      class: `seg ${lang() === l ? 'active' : ''}`,
      'aria-pressed': String(lang() === l),
      onClick: () => {
        setLang(l);
        showHome();
      },
    }, label);

  const soundButton = h('button', {
    class: 'pill',
    onClick: () => {
      setSound(!soundOn());
      showHome();
    },
  }, icon(soundOn() ? 'sound' : 'mute'), `${t('sound')}: ${soundOn() ? t('on') : t('off')}`);

  const header = h('header', { class: 'home-header' },
    h('div', {},
      h('h1', {}, t('appName')),
      h('p', { class: 'tagline' }, t('tagline')),
    ),
    h('div', { class: 'settings' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': t('language') }, langButton('sv', 'Svenska'), langButton('en', 'English')),
      soundButton,
    ),
  );

  let continueCard: HTMLElement | null = null;
  if (saved) {
    const done = saved.pieces.filter((p) => p.state === 'placed').length;
    continueCard = h('button', { class: 'continue-card', onClick: () => void startGame(saved.image, saved.cols, saved.rows, saved.seed, saved) },
      h('img', { src: saved.image.thumb, alt: '' }),
      h('div', {},
        h('div', { class: 'continue-title' }, t('continue')),
        h('div', { class: 'continue-sub' }, t('piecesPlaced', { done, total: saved.pieces.length })),
      ),
    );
  }

  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      openPicker(await fromFile(file));
    } catch {
      alert(t('pictureError'));
    }
  });

  const topics = h('div', { class: 'topics', role: 'tablist' },
    ...TOPICS.filter((topic) => topic.id !== 'recent' || recentImages().length > 0).map((topic) =>
      h('button', {
        class: `chip ${topic.id === currentTopic.id ? 'active' : ''}`,
        role: 'tab',
        'aria-selected': String(topic.id === currentTopic.id),
        onClick: () => {
          currentTopic = topic;
          showHome();
        },
      }, t(topic.label)),
    ),
    h('button', { class: 'chip own', onClick: () => fileInput.click() }, icon('photo'), t('ownPhoto')),
  );

  const gallery = h('div', { class: 'gallery' });
  const more = h('button', { class: 'pill big', onClick: () => void fillGallery(gallery, true) }, icon('refresh'), t('morePictures'));

  app.append(
    h('main', { class: 'home' },
      header,
      continueCard,
      h('h2', {}, t('choosePicture')),
      topics,
      fileInput,
      gallery,
      currentTopic.query ? h('div', { class: 'more' }, more) : null,
      h('footer', { class: 'about' }, t('about')),
    ),
  );
  void fillGallery(gallery, false);
}

async function fillGallery(gallery: HTMLElement, refresh: boolean): Promise<void> {
  const topic = currentTopic;
  galleryAbort?.abort();
  const abort = new AbortController();
  galleryAbort = abort;
  let images = refresh || topic.id === 'recent' ? undefined : galleryCache.get(topic.id);
  let offline = false;
  if (!images) {
    gallery.replaceChildren(h('p', { class: 'status' }, t('loading')));
    try {
      const result = await searchTopic(topic, abort.signal);
      images = result.images;
      offline = result.offline;
      if (topic.id !== 'recent' && !offline) galleryCache.set(topic.id, images);
    } catch (err) {
      if (abort.signal.aborted) return;
      if (!(err instanceof OfflineError)) {
        gallery.replaceChildren(
          h('div', { class: 'status' },
            h('p', {}, t('loadError')),
            h('button', { class: 'pill big', onClick: () => void fillGallery(gallery, true) }, t('tryAgain')),
          ),
        );
        return;
      }
      // Offline and nothing stored for this search: fall back to pictures she has played.
      offline = true;
      images = recentImages();
    }
  }
  // Offline, only offer pictures that are actually stored on the device.
  if (offline) images = await onlyStored(images);
  if (abort.signal.aborted) return;
  const tiles = images.map((img) => {
    const thumb = h('img', { src: img.thumb, alt: '', loading: 'lazy', decoding: 'async' });
    // The small version may not be stored offline even when the full picture is.
    thumb.addEventListener('error', () => {
      if (thumb.src !== img.src) thumb.src = img.src;
    }, { once: true });
    return h('button', { class: 'tile', onClick: () => openPicker(img), 'aria-label': img.title }, thumb);
  });
  gallery.replaceChildren(
    ...(offline ? [h('p', { class: 'status offline' }, images.length ? t('offlineNote') : t('nothingOffline'))] : []),
    ...tiles,
  );
}

// ------------------------------------------------------------------ piece count picker

// 144 pieces are small on screen; zoom, the magnifier and the large-piece tray make them workable.
const LEVELS: { target: number; label: StringKey }[] = [
  { target: 6, label: 'level_1' },
  { target: 12, label: 'level_2' },
  { target: 20, label: 'level_3' },
  { target: 35, label: 'level_4' },
  { target: 50, label: 'level_5' },
  { target: 144, label: 'level_6' },
];
const LEVEL_KEY = 'jigsaw.level';

/** A thumbnail cut into the grid, so the choice is visible rather than just a number. */
function levelGrid(src: string, cols: number, rows: number): HTMLElement {
  const el = h('span', { class: 'level-grid', 'aria-hidden': 'true' });
  el.style.backgroundImage = [
    `repeating-linear-gradient(90deg, transparent 0 calc(100% / ${cols} - 2px), #fff calc(100% / ${cols} - 2px) calc(100% / ${cols}))`,
    `repeating-linear-gradient(0deg, transparent 0 calc(100% / ${rows} - 2px), #fff calc(100% / ${rows} - 2px) calc(100% / ${rows}))`,
    `url("${src}")`,
  ].join(',');
  return el;
}

function openPicker(image: PuzzleImage): void {
  const aspect = image.width / image.height;
  let chosen = Number(localStorage.getItem(LEVEL_KEY) ?? 1);
  if (!(chosen >= 0 && chosen < LEVELS.length)) chosen = 1;
  const hasSaved = loadGame() !== null;

  const buttons = LEVELS.map((lvl, i) => {
    const g = chooseGrid(lvl.target, aspect);
    const b = h('button', {
      class: `level ${i === chosen ? 'active' : ''}`,
      'aria-pressed': String(i === chosen),
      onClick: () => {
        chosen = i;
        buttons.forEach((x, j) => {
          x.classList.toggle('active', j === i);
          x.setAttribute('aria-pressed', String(j === i));
        });
      },
    },
      levelGrid(image.thumb, g.cols, g.rows),
      h('span', { class: 'level-count' }, String(g.cols * g.rows)),
      h('span', { class: 'level-label' }, t(lvl.label)),
    );
    return b;
  });

  const close = () => overlay.remove();
  const start = () => {
    localStorage.setItem(LEVEL_KEY, String(chosen));
    const g = chooseGrid(LEVELS[chosen].target, aspect);
    close();
    void startGame(image, g.cols, g.rows, Math.floor(Math.random() * 2 ** 31));
  };

  const credit = image.license
    ? h('p', { class: 'credit' },
        `${t('photoBy')}: `,
        h('a', { href: image.pageUrl, target: '_blank', rel: 'noopener' }, image.title),
        ` · ${image.author} · ${image.license}`,
      )
    : null;

  const overlay = h('div', { class: 'overlay', onClick: (e) => e.target === overlay && close() },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
      h('img', { class: 'preview', src: image.src, alt: image.title }),
      credit,
      h('h2', {}, t('howManyPieces')),
      h('div', { class: 'levels' }, ...buttons),
      hasSaved ? h('p', { class: 'note' }, t('replaceSaved')) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'pill big secondary', onClick: close }, t('cancel')),
        h('button', { class: 'pill big primary', onClick: start }, t('start')),
      ),
    ),
  );
  document.body.append(overlay);
}

// ------------------------------------------------------------------ play screen

let game: PuzzleGame | null = null;
let saveTimer = 0;

async function startGame(image: PuzzleImage, cols: number, rows: number, seed: number, saved?: SavedGame): Promise<void> {
  game?.destroy();
  game = null;
  app.replaceChildren(h('div', { class: 'loading-screen' }, h('div', { class: 'spinner' }), h('p', {}, t('loadingPicture'))));

  let img: HTMLImageElement;
  try {
    img = await loadImage(image.src);
  } catch {
    alert(t('pictureError'));
    showHome();
    return;
  }

  const counter = h('div', { class: 'counter', 'aria-live': 'polite' });
  const guideBtn = h('button', { class: 'tool toggle' }, icon('guide'), h('span', {}, t('guide')));
  // Toggles the whole picture on the board, so she can compare while zoomed in.
  const previewBtn = h('button', { class: 'tool toggle', 'aria-pressed': 'false' }, icon('eye'), h('span', {}, t('showPicture')));
  const table = h('div', { class: 'table' });

  const save = () => {
    if (!game) return;
    saveGame({ ...game.toSaved(), image });
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(save, 400);
  };

  const toolbar = h('div', { class: 'toolbar' },
    h('button', { class: 'tool', onClick: () => { save(); game?.destroy(); game = null; showHome(); } }, icon('back'), h('span', {}, t('home'))),
    counter,
    h('div', { class: 'tools-right' },
      previewBtn,
      guideBtn,
      h('button', { class: 'tool', onClick: () => game?.gatherPieces() }, icon('gather'), h('span', {}, t('tidy'))),
    ),
  );

  app.replaceChildren(h('div', { class: 'play' }, toolbar, table));
  addRecent(image);
  wakeLock(true);

  const isNew = !saved;
  game = new PuzzleGame(table, {
    image: img,
    cols,
    rows,
    seed,
    saved,
    guide: saved?.guide ?? true,
    onProgress: (done, total) => {
      counter.textContent = t('piecesPlaced', { done, total });
    },
    onChange: scheduleSave,
    labels: { prev: t('trayPrev'), next: t('trayNext'), all: t('trayAll'), big: t('trayBig'), pickHint: t('pickHint'), zoomIn: t('zoomIn'), zoomOut: t('zoomOut') },
    onComplete: () => {
      clearTimeout(saveTimer);
      clearGame();
      playFinish();
      showFinished(image, cols * rows);
    },
  });
  if (import.meta.env.DEV) (window as unknown as { __game: PuzzleGame }).__game = game;
  const syncGuide = () => {
    guideBtn.classList.toggle('active', game?.guideOn ?? false);
    guideBtn.setAttribute('aria-pressed', String(game?.guideOn ?? false));
  };
  previewBtn.addEventListener('click', () => {
    game?.setPreview(!game.previewOn);
    previewBtn.classList.toggle('active', game?.previewOn ?? false);
    previewBtn.setAttribute('aria-pressed', String(game?.previewOn ?? false));
  });
  guideBtn.addEventListener('click', () => {
    game?.setGuide(!game.guideOn);
    syncGuide();
  });
  syncGuide();
  if (isNew) save();
}

function showFinished(image: PuzzleImage, total: number): void {
  const overlay = h('div', { class: 'overlay finished' },
    confetti(),
    h('div', { class: 'sheet small' },
      h('h2', { class: 'big-title' }, t('wellDone')),
      h('p', {}, t('finishedText', { total })),
      h('div', { class: 'actions' },
        h('button', { class: 'pill big secondary', onClick: () => overlay.remove() }, t('lookAtIt')),
        h('button', { class: 'pill big primary', onClick: () => { overlay.remove(); game?.destroy(); game = null; showHome(); } }, t('newPuzzle')),
      ),
      image.license ? h('p', { class: 'credit' }, `${image.title} · ${image.author} · ${image.license}`) : null,
    ),
  );
  document.body.append(overlay);
}

function confetti(): HTMLElement {
  const colors = ['#e76f51', '#f4a261', '#e9c46a', '#2a9d8f', '#8ab17d', '#b56576'];
  const box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  for (let i = 0; i < 80; i++) {
    const bit = h('i');
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = `${Math.random() * 1.2}s`;
    bit.style.animationDuration = `${2.5 + Math.random() * 2}s`;
    bit.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.append(bit);
  }
  return box;
}

// ------------------------------------------------------------------ screen wake lock

let lock: WakeLockSentinel | null = null;

async function wakeLock(on: boolean): Promise<void> {
  try {
    if (on && !lock && 'wakeLock' in navigator) lock = await navigator.wakeLock.request('screen');
    if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    // Not supported or not allowed. The screen may dim; nothing else breaks.
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && game) {
    clearTimeout(saveTimer);
    const saved = loadGame();
    if (saved) saveGame({ ...game.toSaved(), image: saved.image });
  }
  if (document.visibilityState === 'visible' && game) {
    lock = null;
    void wakeLock(true);
  }
});

// Offline support: only in the built app, so the dev server never serves stale files.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
    // Without it the app still works, just not offline.
  });
}

// ------------------------------------------------------------------ updates

declare const __BUILD__: string;
const RESUME_KEY = 'jigsaw.resumeAfterUpdate';

/**
 * A home-screen app on iOS is resumed, not restarted, so it would keep running
 * an old version for days. Whenever it comes back to the screen, ask the
 * server which version is current; if it's newer, reload, and go straight
 * back into the puzzle she was doing.
 */
async function checkForUpdate(): Promise<void> {
  if (!import.meta.env.PROD || !navigator.onLine) return;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = (await res.json()) as { build: string };
    if (build === __BUILD__) return;
    if (game) {
      clearTimeout(saveTimer);
      const saved = loadGame();
      if (saved) saveGame({ ...game.toSaved(), image: saved.image });
      sessionStorage.setItem(RESUME_KEY, '1');
    }
    location.reload();
  } catch {
    // Offline or server trouble: carry on with the version we have.
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void checkForUpdate();
});

const resume = sessionStorage.getItem(RESUME_KEY) === '1' ? loadGame() : null;
sessionStorage.removeItem(RESUME_KEY);
if (resume) void startGame(resume.image, resume.cols, resume.rows, resume.seed, resume);
else showHome();
void checkForUpdate();
