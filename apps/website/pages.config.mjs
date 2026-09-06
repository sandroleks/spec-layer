// These pages retain the existing public URLs and published source text.
export const infoPages = [
  { slug: 'support', title: 'Support', description: 'Get help with Spec Layer licensing, AI writing, library publishing, pull keys, and refunds.' },
  { slug: 'privacy', title: 'Privacy Policy', description: 'How Spec Layer handles design context, published libraries, AI processing, licensing, and personal data.' },
  { slug: 'terms', title: 'Terms of Service', description: 'Terms for using Spec Layer, including licensing, billing, fair use, and third-party services.' },
  { slug: 'security', title: 'Security & responsible disclosure', description: 'Report security issues in Spec Layer and read the responsible disclosure process and scope.' },
  { slug: 'refund', title: 'Refund Policy', description: 'Spec Layer’s 30-day refund policy and how to request a refund for Pro.' }
];
export const infoPageUrl = page => `/${page.slug}`;
