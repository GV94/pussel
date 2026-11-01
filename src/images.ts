// Picture sources. Everything comes from Wikimedia Commons, filtered to CC0 or
// public domain only, using Commons structured data (P275 = licence,
// P6216 = copyright status). No API key needed and CORS is open (origin=*).

import type { StringKey } from './i18n';

export type PuzzleImage = {
  /** Stable id, used for saving. */
  id: string;
  /** Full-size URL used for the puzzle (≈1920 px wide). */
  src: string;
  /** Small URL for the gallery grid. */
  thumb: string;
  width: number;
  height: number;
  title: string;
  author: string;
  license: string;
  /** Page with full credit and licence details. */
  pageUrl: string;
};

export type Topic = { id: string; label: StringKey; query?: string };

const FREE = 'haswbstatement:P275=Q6938433|P6216=Q19652 filew:>1600';

export const TOPICS: Topic[] = [
  { id: 'samples', label: 'topic_samples' },
  { id: 'flowers', label: 'topic_flowers', query: `deepcat:Quality_images_of_flowers ${FREE}` },
  { id: 'landscapes', label: 'topic_landscapes', query: `deepcat:Quality_images_of_landscapes ${FREE}` },
  { id: 'sweden', label: 'topic_sweden', query: `deepcat:Quality_images_of_Sweden ${FREE}` },
  { id: 'birds', label: 'topic_birds', query: `deepcat:Quality_images_of_birds ${FREE}` },
  {
    id: 'animals',
    label: 'topic_animals',
    query: `deepcat:Quality_images_of_mammals ${FREE} -skull -skeleton -MNHN -stuffed -museum -Alfort -taxidermy`,
  },
  { id: 'sea', label: 'topic_sea', query: `deepcat:Quality_images_of_coasts ${FREE}` },
  { id: 'paintings', label: 'topic_paintings', query: `deepcat:Featured_pictures_of_paintings ${FREE}` },
];

const API = 'https://commons.wikimedia.org/w/api.php';
const ALLOWED_LICENSE = /^(cc0|public domain|pdm)/i;

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

type CommonsPage = {
  pageid: number;
  title: string;
  imageinfo?: {
    width: number;
    height: number;
    mime: string;
    thumburl?: string;
    descriptionurl: string;
    extmetadata?: Record<string, { value: string } | undefined>;
  }[];
};

function toPuzzleImage(p: CommonsPage): PuzzleImage | null {
  const info = p.imageinfo?.[0];
  if (!info?.thumburl) return null;
  if (info.mime !== 'image/jpeg' && info.mime !== 'image/png') return null;
  const aspect = info.width / info.height;
  if (aspect < 0.65 || aspect > 2.1) return null;
  const meta = info.extmetadata ?? {};
  const license = meta.LicenseShortName?.value ?? '';
  if (!ALLOWED_LICENSE.test(license)) return null;
  // The file name reads better than ObjectName, which often holds every translation at once.
  const title = p.title.replace(/^File:/, '').replace(/\.\w+$/, '').replace(/_/g, ' ');
  const author = stripHtml(meta.Artist?.value ?? '').slice(0, 120) || 'Wikimedia Commons';
  // Commons serves fixed thumbnail widths; swap the width in the URL for the grid.
  const thumb = info.thumburl.replace(/\/\d+px-/, '/500px-');
  return {
    id: `commons:${p.pageid}`,
    src: info.thumburl,
    thumb,
    width: info.width,
    height: info.height,
    title,
    author,
    license,
    pageUrl: info.descriptionurl,
  };
}

export async function searchTopic(topic: Topic, signal?: AbortSignal): Promise<PuzzleImage[]> {
  if (!topic.query) return loadSamples();
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: '50',
    gsrsort: 'random',
    gsrsearch: topic.query,
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1920',
    iiextmetadatafilter: 'LicenseShortName|Artist',
  });
  const res = await fetch(`${API}?${params}`, { signal });
  if (!res.ok) throw new Error(`Commons ${res.status}`);
  const json = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
  const pages = Object.values(json.query?.pages ?? {});
  return pages.map(toPuzzleImage).filter((x): x is PuzzleImage => x !== null).slice(0, 24);
}

/** Bundled pictures that work offline. See public/samples/credits.json. */
export async function loadSamples(): Promise<PuzzleImage[]> {
  const base = import.meta.env.BASE_URL;
  const res = await fetch(`${base}samples/credits.json`);
  type Entry = Omit<PuzzleImage, 'src' | 'thumb'> & { file: string; thumbFile: string };
  const list = (await res.json()) as Entry[];
  return list.map(({ file, thumbFile, ...rest }) => ({
    ...rest,
    src: `${base}samples/${file}`,
    thumb: `${base}samples/${thumbFile}`,
  }));
}

/** Load an image element, resolving when it's decoded. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/**
 * Turn a photo the user picked into a puzzle image. Downscaled and stored as a
 * data URL so it survives a reload.
 */
export async function fromFile(file: File): Promise<PuzzleImage> {
  const bitmap = await createImageBitmap(file);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const src = canvas.toDataURL('image/jpeg', 0.85);
  return {
    id: `own:${Date.now()}`,
    src,
    thumb: src,
    width: w,
    height: h,
    title: file.name,
    author: '',
    license: '',
    pageUrl: '',
  };
}
