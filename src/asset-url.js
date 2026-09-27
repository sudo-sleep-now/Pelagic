// Vite replaces BASE_URL with the deployment path at build time.
export const assetUrl = path => `${import.meta.env.BASE_URL}${path}`;
