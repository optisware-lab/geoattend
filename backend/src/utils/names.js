// Every staff name is stored the same way: each part starts with a capital
// letter and the rest is small. "bright ANYAWE" -> "Bright Anyawe".
// Parts joined by a hyphen or apostrophe are capitalised too:
// "ama-serwaa" -> "Ama-Serwaa", "o'neil" -> "O'Neil".

const MAX_LENGTH = 100;

function formatName(value) {
  if (value == null) return value;
  return String(value)
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en')
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep, letter) => sep + letter.toLocaleUpperCase('en'))
    .slice(0, MAX_LENGTH);
}

module.exports = { formatName };
