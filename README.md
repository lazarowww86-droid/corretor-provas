# Corretor de Provas

Aplicativo web (PWA) que corrige cartões-resposta fotografados pela câmera do celular. Funciona offline depois de instalado e guarda tudo no próprio aparelho.

## Recursos
- Turmas, alunos (importação de TXT, CSV, PDF ou Word), avaliações e gabaritos
- Cartões de 1 a 24 questões, com 4 ou 5 alternativas, e QR individual por aluno
- Leitura óptica (OMR) por câmera ou foto, com aviso de marca fraca, dupla ou em branco
- Câmera em resolução máxima, com dicas ao vivo (aproxime, afaste, pouca luz, sombra)
- QR lido também de forma "retificada": o app endireita e amplia a região do QR usando os quatro marcadores
- Resultados por turma e avaliação, exportação em CSV
- Backup e restauração completos em JSON

## Como publicar (GitHub Pages)
1. Envie estes arquivos para a raiz do repositório.
2. Em **Settings > Pages**, escolha **Deploy from a branch**, branch **main** e pasta **/ (root)**.
3. Abra o endereço https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/ e instale o app pelo navegador.

## Como rodar localmente
```bash
python3 -m http.server 8080
# abra http://localhost:8080
```

## Testes
```bash
npm install
npx playwright install chromium
npm test
```
Cobrem o motor de leitura com cartões simulados (rotação, perspectiva, sombra, ruído, caneta e lápis), o QR retificado, as dicas ao vivo da câmera e o app inteiro no Chromium. O GitHub Actions roda tudo a cada push.

## Estrutura
- `index.html`: interface e regras do app
- `omr-engine.js`: motor de leitura óptica
- `jsQR.js`: leitor de QR reserva
- `sw.js` e `manifest.webmanifest`: instalação e uso offline
- `tests/`: testes automáticos

> Ao alterar qualquer arquivo do app, mude a versão do cache em `sw.js` para que quem já instalou receba a atualização.
