import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// A versão da app vive só no package.json; aqui passa para o código como __APP_VERSION__.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Política de segurança de conteúdo (só nas versões compiladas: o servidor de desenvolvimento precisa de scripts inline).
// Liga a: a própria app, Supabase, fornecedores de IA (https) e modelos locais (Ollama/LM Studio).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');
const cspPlugin = {
  name: 'wallet-csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string) => html.replace('<head>', `<head>
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
};

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), cspPlugin],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
