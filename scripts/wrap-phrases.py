# Envolve em L('...') as frases portuguesas que existem em src/i18n/phrases.ts.
# Uso: python scripts/wrap-phrases.py src/pages/A.tsx src/pages/B.tsx ...
import re, sys, os

src = open('src/i18n/phrases.ts', encoding='utf8').read()
phrases = [m.group(1).replace("\\'", "'") for m in re.finditer(r"^  '((?:[^'\\]|\\.)+)': \[", src, re.M)]
phrases.sort(key=len, reverse=True)

def esc(p):
    return p.replace("'", "\\'")

for f in sys.argv[1:]:
    s = open(f, encoding='utf8').read()
    orig = s
    for p in phrases:
        q = re.escape(p)
        # JSX text: >Texto<  (com espaços à volta)
        s = re.sub(r'>(\s*)' + q + r'(\s*)<', lambda m: '>' + m.group(1) + "{L('" + esc(p) + "')}" + m.group(2) + '<', s)
        # atributos: placeholder="Texto" / title / aria-label / label
        s = re.sub(r'\b(placeholder|title|aria-label|label|text)="' + q + '"', lambda m: m.group(1) + "={L('" + esc(p) + "')}", s)
        # literais em expressões: 'Texto' (não já dentro de L( nem t( )
        s = re.sub(r"(?<![\w(])'" + re.escape(esc(p)) + r"'", "L('" + esc(p) + "')", s)
        s = re.sub(r"(?<=[^L]\()'" + re.escape(esc(p)) + r"'(?=\))", "L('" + esc(p) + "')", s)
    # confirm('...') já fica confirm(L('...')) pela regra acima
    s = s.replace("L(L(", "L(")
    if s != orig:
        if "from '../i18n/phrases'" not in s and "from './i18n/phrases'" not in s:
            rel = os.path.relpath('src/i18n/phrases', os.path.dirname(f)).replace('\\', '/')
            if not rel.startswith('.'): rel = './' + rel
            s = re.sub(r"(^import [^\n]+\n)(?!import)", r"\1import { L } from '" + rel + "';\n", s, count=1, flags=re.M)
        open(f, 'w', encoding='utf8').write(s)
        print('wrapped', f, s.count("L('") - orig.count("L('"))
