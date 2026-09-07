// The final public origin stays separate from the private Sites preview URL.
const mode = process.env.SPEC_LAYER_SITE_MODE || 'preview';
if (!['preview', 'production'].includes(mode)) {
  throw new Error('SPEC_LAYER_SITE_MODE must be preview or production.');
}

export const site = {
  name: 'Spec Layer',
  origin: 'https://spec-layer.com',
  mode,
  indexable: mode === 'production',
  homeTitle: 'Spec Layer | Figma design system documentation',
  homeDescription: 'Document Figma components, variables, and styles. Share component YAML and DTCG design tokens with developers and AI coding agents through Spec Layer.',
  image: '/social/spec-layer.png',
  imageAlt: 'Spec Layer. Your design system. Ready to build. Documentation and context from Figma.',
};

export const absoluteUrl = path => new URL(path, site.origin).href;
