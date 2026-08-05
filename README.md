# BandTracks — player multipista para a banda

Site estático para ensaio: cada integrante escolhe uma música e ouve todas as pistas
juntas, ajustando o volume de cada uma, com botões de **mudo** e **solo** e
**controle de velocidade** para estudar trechos difíceis.
Hospedagem no GitHub Pages, sem servidor e sem custo.

- **Área do usuário** (`index.html`) — acesso livre.
- **Área do administrador** (`admin.html`) — login e envio de novas músicas.

---

## 1. Como usar (integrantes)

| Ação | Desktop | Celular |
|---|---|---|
| Escolher música | lista fixa à esquerda | botão ☰ no canto superior esquerdo |
| Volume da pista | barra ao lado do nome | barra abaixo do nome |
| **M** — mudo | silencia a pista | idem |
| **S** — solo | toca só as pistas em solo | idem |
| Tocar / pausar | botão laranja ou **espaço** | botão laranja |
| Avançar 5 s | seta → / seta ← | arrastar a barra de tempo |
| Voltar ao início | tecla **Home** | botão ⏮ |
| **Velocidade** | botão *Velocidade*, ou teclas **−** **+** **0** | botão *Velocidade* |

Com **várias pistas em solo**, todas elas tocam juntas e as demais ficam mudas —
exatamente como numa mesa de som. O botão **Limpar mudo/solo** zera tudo.

---

## 2. Controle de velocidade

Clique em **Velocidade** ao lado dos botões de transporte. O painel traz:

- **Velocidades rápidas:** 0,50× · 0,65× · 0,75× · 0,85× · 1,00×
- **Ajuste fino:** de 0,25× a 1,00× em incrementos de 0,05
- **Manter o tom original** (ligado por padrão)
- **Voltar para 1,00×**

Atalhos de teclado: **−** reduz, **+** aumenta, **0** volta ao normal.

A velocidade é aplicada a todas as pistas simultaneamente e é preservada ao trocar
de música. A barra de tempo continua mostrando o tempo real da música (uma música
de 3:00 mostra 3:00 mesmo em 0,50× — apenas leva o dobro do tempo para tocar).

### Qualidade nas diferentes velocidades

O navegador estica o áudio no tempo sem alterar o tom, usando um algoritmo do tipo
WSOLA (sobreposição de pequenos blocos). A qualidade depende de quanto se afasta
de 1,00×:

| Faixa | Qualidade | Uso recomendado |
|---|---|---|
| 0,85× – 1,00× | praticamente idêntica ao original | leitura corrida, ensaio |
| 0,70× – 0,85× | leve perda em pratos e ataques | passagens rápidas |
| 0,50× – 0,70× | artefatos audíveis, mas totalmente utilizável | estudo de solos e levadas |
| **abaixo de 0,50×** | **degradação forte; pode ficar mudo** | último recurso |

**Por que 0,50× é o piso seguro:** a documentação do MDN registra que a maioria dos
navegadores interrompe o áudio fora da faixa de 0,50× a 4× e recomenda limitar o
controle a esse intervalo. O Firefox, especificamente, silencia o som abaixo de
0,50×. Em teste no Chromium, o áudio continuou saindo até 0,20×, mas com queda
expressiva de nível — ou seja, o comportamento abaixo de 0,50× **varia conforme o
navegador**.

Por isso o controle vai até 0,25× conforme pedido, mas exibe um aviso abaixo de
0,50×. Se ficar mudo no celular de algum integrante, é isso: suba para 0,50×.

---

## 3. Recomendações para os arquivos de áudio

| Item | Sugestão |
|---|---|
| Formato | `.mp3`, 128–192 kbps (mono já basta para pistas de ensaio) |
| Tamanho | até ~20 MB por arquivo; o limite da API do GitHub é 100 MB |
| Duração | **todas as pistas da mesma música com a duração exata** |
| Início | todas começando no mesmo instante zero, sem silêncio extra em uma delas |
| Repositório | o GitHub recomenda manter o total abaixo de 1 GB |

O alinhamento é o ponto crítico: o player toca os arquivos em paralelo e corrige
desvios, mas não conserta pistas exportadas com offsets diferentes. Exporte todas
do mesmo projeto, do compasso 1 ao fim, com o mesmo codificador e as mesmas
configurações.

---

## 4. Estrutura dos arquivos

```
bandtracks/
├── index.html            área do usuário
├── admin.html            área do administrador
├── config.js             nome da banda, repositório, senha (hash), velocidades
├── serve.py              servidor local de teste (com suporte a Range)
├── assets/
│   ├── css/style.css
│   └── js/
│       ├── engine.js     motor multipista (Web Audio API + velocidade)
│       ├── player.js     interface do usuário
│       ├── github.js     cliente da API do GitHub
│       └── admin.js      interface do administrador
├── data/songs.json       catálogo (gerado/atualizado pelo admin)
└── audio/                pistas .mp3
```

### Formato do catálogo

```json
{
  "version": 1,
  "songs": [
    {
      "id": "minha-musica-l2k3j",
      "title": "Minha Música",
      "artist": "Autor",
      "notes": "tom de Ré, 120 bpm",
      "tracks": [
        { "name": "Bateria", "file": "audio/minha-musica/01-bateria.mp3", "volume": 0.85 }
      ]
    }
  ]
}
```

Dá para editar esse arquivo à mão e subir os `.mp3` pelo próprio site do GitHub,
sem usar a área do administrador.

---

## 5. Notas técnicas

- Cada pista é um `<audio>` (streaming) ligado a um `GainNode` do Web Audio API.
  O consumo de memória é baixo, o que permite muitas pistas no celular.
- A velocidade usa `playbackRate` com `preservesPitch`, aplicada a todos os
  elementos de áudio. Não há custo de memória nem de processamento relevante.
- Um verificador roda a cada 500 ms e realinha qualquer pista que desvie da
  referência. A tolerância (`syncTolerance`, padrão 0,08 s) é escalada pela
  velocidade, para que o erro percebido permaneça constante em tempo real.
  Em teste, a deriva entre 6 pistas ficou abaixo de 25 ms em todas as velocidades.
- Mudanças de volume usam rampa curta (15 ms) para não estalar.
- No iPhone, o áudio só começa após o primeiro toque no botão tocar — restrição do
  próprio iOS. Mantenha o interruptor lateral fora do modo silencioso.
