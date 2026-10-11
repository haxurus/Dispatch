import { ogImageAlt, ogImageSize, renderOgImage } from '../_components/og-image';

export const alt = ogImageAlt.it;
export const size = ogImageSize;
export const contentType = 'image/png';

export default function Image() {
  return renderOgImage('it');
}
