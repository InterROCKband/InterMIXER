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
| Voltar ao início (do trecho) | tecla **Home** ou botão ⏮ | botão ⏮ |
| **Velocidade** | botão *Velocidade*, ou teclas **−** **+** **0** | botão *Velocidade* |
| **Loop** | botão *Loop*, ou tecla **L** | botão *Loop* |

Com **várias pistas em solo**, todas tocam juntas e as demais ficam mudas —
como numa mesa de som. **Limpar mudo/solo** zera tudo.

---

## 2. Loop de trecho

Clique em **Loop** (ou tecla **L**). Aparecem, na barra de tempo, duas alças azuis:
uma no início e outra no fim. Arraste-as para delimitar o trecho — o segmento
selecionado fica **realçado em azul** e o restante da barra fica **apagado**. Ao lado
do botão, a caixa **Trecho** mostra o tempo inicial e final (com décimos de segundo).

Ao dar **play**, o trecho toca em repetição infinita até você apertar **parar** ou a
**barra de espaço**. Você pode:

- **arrastar as alças com a música tocando** — o trecho muda na hora, sem parar o som;
- **mudar a velocidade durante o loop** — funciona em qualquer ponto, inclusive
  enquanto repete;
- **ajustar volume, mudo e solo durante o loop** — tudo continua respondendo normalmente.

O botão **⟲ Reset** (ao lado) devolve as alças aos extremos. Com as alças nos extremos
e o loop ligado, a música inteira repete como um *repeat*. Clicar em **Loop** de novo
desliga a função e faz as alças desaparecerem.

Observações:

- Os pontos do loop são guardados em **tempo de mídia**, não em tempo de parede.
  Por isso o loop é **independente da velocidade**: um trecho de 8 s continua sendo
  o mesmo trecho a 1,00× ou a 0,50× (apenas leva mais tempo para repetir a 0,50×).
- Trocar de música reinicia o loop para os extremos.
- Há uma largura mínima de trecho (padrão 1 s, ajustável em `config.js` →
  `loop.minSpan`) para as alças não se cruzarem.

Em teste automatizado, o salto de volta ao início do trecho ocorreu corretamente em
todas as velocidades, com deriva de 0 ms entre as 6 pistas, e o áudio não foi
interrompido ao mexer no mixer ou nas alças durante a repetição.

---

## 3. Controle de velocidade

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

- Cada pista é um `<audio>` (streaming) ligado a um `GainNode` do Web Audio API —
  baixo consumo de memória, permitindo muitas pistas no celular.
- A velocidade usa `playbackRate` com `preservesPitch`, aplicada a todos os áudios.
- O **loop** é verificado no laço de animação (~60 fps), com um backstop a cada
  250 ms caso a aba perca o foco. Quando o cursor atinge o fim do trecho (com uma
  margem proporcional à velocidade), todas as pistas saltam juntas para o início.
- Um verificador realinha qualquer pista que desvie da referência; a tolerância
  (`syncTolerance`, padrão 0,08 s) é escalada pela velocidade.
- Mudanças de volume usam rampa curta (15 ms) para não estalar.
- No iPhone, o áudio só começa após o primeiro toque no botão tocar — restrição do
  iOS. Mantenha o interruptor lateral fora do modo silencioso.
- No iPhone, o áudio só começa após o primeiro toque no botão tocar — restrição do
  próprio iOS. Mantenha o interruptor lateral fora do modo silencioso.
