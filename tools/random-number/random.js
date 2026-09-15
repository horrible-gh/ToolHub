export const MIN_INTEGER = -2147483648;
export const MAX_INTEGER = 2147483647;
export const MAX_COUNT = 1000;
const UINT32_RANGE = 0x100000000;

function validateInteger(value, label) {
  if (!Number.isInteger(value)) throw new TypeError(label + ' must be an integer');
  if (value < MIN_INTEGER || value > MAX_INTEGER) {
    throw new RangeError(label + ' must be between ' + MIN_INTEGER + ' and ' + MAX_INTEGER);
  }
}

export function validateRandomNumberOptions({ min, max, count, unique = false }) {
  validateInteger(min, 'Minimum');
  validateInteger(max, 'Maximum');
  if (min > max) throw new RangeError('Minimum must be less than or equal to maximum');
  if (!Number.isInteger(count)) throw new TypeError('Count must be an integer');
  if (count < 1) throw new RangeError('Count must be at least 1');
  if (count > MAX_COUNT) throw new RangeError('Count must not exceed ' + MAX_COUNT);
  const rangeSize = max - min + 1;
  if (unique && count > rangeSize) throw new RangeError('Unique count exceeds the available range');
  return { min, max, count, unique: Boolean(unique), rangeSize };
}

function sampleBelow(rangeSize, randomUint32) {
  if (!Number.isInteger(rangeSize) || rangeSize < 1 || rangeSize > UINT32_RANGE) throw new RangeError('Random range size is unsupported');
  const limit = Math.floor(UINT32_RANGE / rangeSize) * rangeSize;
  let value;
  do {
    value = randomUint32();
    if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) throw new TypeError('Random source must return a uint32 integer');
  } while (value >= limit);
  return value % rangeSize;
}

export function randomIntInclusive(min, max, randomUint32) {
  validateInteger(min, 'Minimum');
  validateInteger(max, 'Maximum');
  if (min > max) throw new RangeError('Minimum must be less than or equal to maximum');
  if (typeof randomUint32 !== 'function') throw new TypeError('Random source must be a function');
  return min + sampleBelow(max - min + 1, randomUint32);
}

export function generateRandomNumbers(options, randomUint32) {
  const { min, count, unique, rangeSize } = validateRandomNumberOptions(options);
  if (typeof randomUint32 !== 'function') throw new TypeError('Random source must be a function');
  if (!unique) return Array.from({ length: count }, () => min + sampleBelow(rangeSize, randomUint32));

  const swaps = new Map();
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const selectedIndex = index + sampleBelow(rangeSize - index, randomUint32);
    const selectedValue = swaps.get(selectedIndex) ?? selectedIndex;
    swaps.set(selectedIndex, swaps.get(index) ?? index);
    results.push(min + selectedValue);
  }
  return results;
}