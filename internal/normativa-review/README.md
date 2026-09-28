# Visor local de normativa

Este es un visor estático y autónomo para revisión interna. No importa código,
sesiones, datos ni componentes de Territorio Base.

Desde la raíz del repositorio:

```sh
python3 -m http.server 4174
```

Después abrir `http://localhost:4174/internal/normativa-review/`. Los registros
canónicos, sus fuentes y límites se mantienen en
[`docs/normativa`](../../docs/normativa/README.md).

La pestaña **Fuentes y documentos** abre primero fichas locales. Las copias
verificadas están en `library/`; las demás fuentes conservan su origen oficial
y quedan marcadas como pendientes hasta contar con un archivo descargable y
reproducible. Esto evita que un portal remoto inestable se presente como un
documento disponible.
