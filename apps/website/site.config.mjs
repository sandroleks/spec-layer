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
  cloudflareManagedRobots: true,
  homeTitle: 'Figma design system documentation | Spec Layer',
  homeDescription: 'Generate design system docs from Figma components, variables, and styles. Share specs and design tokens with your team and AI coding agents. Start free.',
  image: '/social/spec-layer.png',
  imageAlt: 'Spec Layer. Your design system. Ready to build. Documentation and context from Figma.',
};

export const absoluteUrl = path => new URL(path, site.origin).href;
