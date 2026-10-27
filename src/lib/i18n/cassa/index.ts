// Composes the `cassa` i18n domain (the POS ticket) from one file per part,
// so header, lines and footer strings can change independently.
import * as header from "./header";
import * as lines from "./lines";
import * as footer from "./footer";

export const cassaIt = {
  header: header.it,
  lines: lines.it,
  footer: footer.it,
};

export const cassaEn: typeof cassaIt = {
  header: header.en,
  lines: lines.en,
  footer: footer.en,
};
