# Fix rápido do conflito em `backtest/robustness.py`

Se o GitHub mostrar conflito no bloco de imports (com `<<<<<<<` / `>>>>>>>`), substitua TODO o bloco por este:

```python
import logging
import random
import sqlite3
from dataclasses import replace
from datetime import datetime

import numpy as np

from backtest import Backtester
from strategy import Signal, generate_all_signals
from question_matcher import match_polymarket_to_metaculus, match_polymarket_to_manifold
```

Depois confirme que não existe nenhum marcador de conflito no arquivo:
- `<<<<<<<`
- `=======`
- `>>>>>>>`

E faça commit da resolução.
