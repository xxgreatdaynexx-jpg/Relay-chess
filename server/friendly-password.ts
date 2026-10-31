import { randomInt } from 'node:crypto';

/** 256 common words (none start with i/o, so no I/O confusion after capitalising). */
export const FRIENDLY_WORDS = `
  amber anchor anvil apple arrow aspen atlas badge baker bamboo banjo barley basin beach beacon berry
  birch biscuit bison blade blaze bloom board bobcat bonus brass bread breeze brick bridge brook brush
  bucket buffalo bundle butter cabin cactus camel candle canoe canyon carbon cargo carpet cashew castle cedar
  chalk charm cherry chess chimney cider cinder circus citrus clam clover cobalt cocoa comet copper coral
  cotton cougar coyote crane crater cricket crown crystal cub dagger daisy delta desert diamond dragon drum
  dune eagle elk ember engine falcon feather fern ferry fiddle field finch flame flint forest fossil
  fox frost galaxy garden garnet gecko geyser ginger glacier glove goat gopher granite grape gravel guitar
  hammer harbor harvest hatchet hawk hazel helmet hermit heron hickory honey horizon hornet husky jacket jade
  jaguar jasper jelly jungle kayak kettle kitten kiwi koala ladder lagoon lantern laser lemon lentil leopard
  lily linen lizard llama lobster magnet mango maple marble market meadow melon mesa meteor mint mitten
  monkey moose mosaic moss muffin nectar needle nickel nugget nutmeg paddle panda panther parrot peach peanut
  pebble pecan pepper pickle pigeon pillow pine pirate planet plum pocket pony poppy prairie pretzel puffin
  pumpkin quail quartz quill rabbit radar radish ranger raven reef ribbon river robin rocket rose rover
  ruby saddle saffron sage salmon sandal satin scarf shadow shark shield silver sketch slate snow sparrow
  spider sprout spruce squid star stone storm summer sunset swan tango thunder tiger timber toast tomato
  topaz torch tractor trumpet tulip tundra turkey turtle tusk valley vapor velvet violet volcano waffle walnut
`.trim().split(/\s+/);

const DIGITS = '23456789'; // no 0/1

/** e.g. Copper-River-Stone-Maple-4827: 4 words (32 bits) + 4 digits from 2-9 (12 bits) = 44 bits; login is rate-limited. */
export function friendlyPassword(): string {
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  const words = Array.from({ length: 4 }, () => cap(FRIENDLY_WORDS[randomInt(FRIENDLY_WORDS.length)]));
  const digits = Array.from({ length: 4 }, () => DIGITS[randomInt(DIGITS.length)]).join('');
  return [...words, digits].join('-');
}
