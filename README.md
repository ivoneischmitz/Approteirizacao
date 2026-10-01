# App Roteirização

Aplicativo web para planejar e otimizar rotas de entrega. Roda direto no navegador, sem build e sem backend.

## Funcionalidades

- **Adicionar paradas** buscando o endereço (OpenStreetMap/Nominatim) ou clicando no mapa. O primeiro ponto é a origem (depósito).
- **Otimizar a rota**: calcula a matriz real de tempo/distância por estrada (OSRM) e ordena as paradas com vizinho mais próximo + 2-opt + Or-opt.
  - Critério: menor tempo ou menor distância.
  - Opção de retornar ou não à origem.
  - Mostra a economia em relação à ordem original.
- **Traçado no mapa** seguindo as ruas, com distância total e tempo estimado.
- **Ajuste manual** da ordem (↑ ↓) e remoção de paradas.
- **Abrir no Google Maps** para navegação (rotas longas são divididas em trechos de até 10 paradas, limite do Google Maps).
- **Importar/Exportar CSV**. Na importação, cada linha pode ser:
  - `nome;latitude;longitude`
  - `latitude,longitude`
  - um endereço livre (será geocodificado, 1 por segundo)
- As paradas ficam salvas no navegador (localStorage).
- Se o servidor de rotas estiver fora do ar, usa distância em linha reta (velocidade média de 40 km/h) como alternativa.

## Como executar

Qualquer servidor estático serve, por exemplo:

```bash
npm start            # npx serve na porta 8080
# ou
python3 -m http.server 8080
```

Depois abra http://localhost:8080. Também pode ser publicado no GitHub Pages sem nenhuma alteração.

## Testes

```bash
npm test
```

Os testes cobrem o otimizador (`js/optimizer.js`): distância haversine, custo de rota, heurísticas e geração dos links do Google Maps.

## Estrutura

```
index.html          interface
css/style.css       estilos (com tema escuro e layout para celular)
js/app.js           mapa, busca, integração com OSRM/Nominatim, importação/exportação
js/optimizer.js     algoritmos de otimização (sem dependências)
tests/              testes com node:test
```

## Observações

Os serviços públicos de demonstração do OSRM e do Nominatim têm limites de uso e são indicados para volumes pequenos. Para produção, recomenda-se hospedar instâncias próprias ou usar um provedor comercial e ajustar as constantes `OSRM` e `NOMINATIM` em `js/app.js`.
