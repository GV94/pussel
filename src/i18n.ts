export type Lang = 'sv' | 'en';

const strings = {
  appName: { sv: 'Pussel', en: 'Jigsaw' },
  tagline: { sv: 'Lugna pussel. Ingen reklam.', en: 'Calm puzzles. No ads.' },
  continue: { sv: 'Fortsätt pusslet', en: 'Continue puzzle' },
  piecesPlaced: { sv: '{done} av {total} bitar', en: '{done} of {total} pieces' },
  choosePicture: { sv: 'Välj en bild', en: 'Choose a picture' },
  morePictures: { sv: 'Visa andra bilder', en: 'Show other pictures' },
  loading: { sv: 'Hämtar bilder…', en: 'Loading pictures…' },
  loadError: {
    sv: 'Kunde inte hämta bilder. Kontrollera internet och försök igen.',
    en: 'Could not load pictures. Check the internet and try again.',
  },
  tryAgain: { sv: 'Försök igen', en: 'Try again' },
  ownPhoto: { sv: 'Mitt eget foto', en: 'My own photo' },
  ownPhotoHint: { sv: 'Välj en bild från iPaden', en: 'Pick a picture from the iPad' },

  topic_flowers: { sv: 'Blommor', en: 'Flowers' },
  topic_landscapes: { sv: 'Landskap', en: 'Landscapes' },
  topic_sweden: { sv: 'Sverige', en: 'Sweden' },
  topic_birds: { sv: 'Fåglar', en: 'Birds' },
  topic_animals: { sv: 'Djur', en: 'Animals' },
  topic_sea: { sv: 'Hav och kust', en: 'Sea and coast' },
  topic_paintings: { sv: 'Konst', en: 'Paintings' },
  topic_samples: { sv: 'Utvalda', en: 'Favourites' },
  topic_recent: { sv: 'Senaste', en: 'Recent' },
  offlineNote: {
    sv: 'Ingen internetanslutning. Här är bilderna som finns sparade på enheten.',
    en: 'No internet connection. Here are the pictures saved on this device.',
  },
  nothingOffline: {
    sv: 'Inga sparade bilder i den här gruppen. Prova Utvalda eller Senaste.',
    en: 'No saved pictures in this group. Try Favourites or Recent.',
  },

  howManyPieces: { sv: 'Hur många bitar?', en: 'How many pieces?' },
  level_1: { sv: 'Mycket lätt', en: 'Very easy' },
  level_2: { sv: 'Lätt', en: 'Easy' },
  level_3: { sv: 'Lagom', en: 'Medium' },
  level_4: { sv: 'Utmanande', en: 'Challenging' },
  level_5: { sv: 'Svår', en: 'Hard' },
  level_6: { sv: 'Expert', en: 'Expert' },
  trayPrev: { sv: 'Föregående bitar', en: 'Previous pieces' },
  trayNext: { sv: 'Fler bitar', en: 'More pieces' },
  trayAll: { sv: 'Alla bitar', en: 'All pieces' },
  zoomIn: { sv: 'Zooma in', en: 'Zoom in' },
  zoomOut: { sv: 'Zooma ut', en: 'Zoom out' },
  pickHint: { sv: 'Tryck på en bit, sedan där den ska ligga', en: 'Tap a piece, then tap where it goes' },
  trayBig: { sv: 'Stora bitar', en: 'Large pieces' },
  pieces: { sv: 'bitar', en: 'pieces' },
  start: { sv: 'Börja pussla', en: 'Start puzzle' },
  cancel: { sv: 'Avbryt', en: 'Cancel' },
  replaceSaved: {
    sv: 'Det pågående pusslet ersätts.',
    en: 'This replaces the puzzle in progress.',
  },

  home: { sv: 'Hem', en: 'Home' },
  showPicture: { sv: 'Bilden', en: 'Picture' },
  guide: { sv: 'Hjälpbild', en: 'Guide' },
  tidy: { sv: 'Samla', en: 'Gather' },
  loadingPicture: { sv: 'Förbereder pusslet…', en: 'Getting the puzzle ready…' },
  pictureError: { sv: 'Bilden kunde inte hämtas. Välj en annan bild.', en: 'The picture could not be loaded. Please choose another.' },
  settings: { sv: 'Inställningar', en: 'Settings' },
  tapToClose: { sv: 'Tryck för att stänga', en: 'Tap to close' },

  wellDone: { sv: 'Bra jobbat!', en: 'Well done!' },
  finishedText: { sv: 'Du lade alla {total} bitar.', en: 'You placed all {total} pieces.' },
  newPuzzle: { sv: 'Nytt pussel', en: 'New puzzle' },
  lookAtIt: { sv: 'Titta på bilden', en: 'Look at the picture' },

  sound: { sv: 'Ljud', en: 'Sound' },
  on: { sv: 'På', en: 'On' },
  off: { sv: 'Av', en: 'Off' },
  language: { sv: 'Språk', en: 'Language' },
  photoBy: { sv: 'Bild', en: 'Picture' },
  about: {
    sv: 'Fri och öppen källkod. Bilderna kommer från Wikimedia Commons och är fria att använda (CC0 eller allmän egendom).',
    en: 'Free and open source. Pictures come from Wikimedia Commons and are free to use (CC0 or public domain).',
  },
} satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof strings;

const LANG_KEY = 'jigsaw.lang';

function detect(): Lang {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === 'sv' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('sv') ? 'sv' : 'en';
}

let current: Lang = detect();

export function lang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  current = l;
  localStorage.setItem(LANG_KEY, l);
  document.documentElement.lang = l;
}

export function t(key: StringKey, vars: Record<string, string | number> = {}): string {
  let s: string = strings[key][current];
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
