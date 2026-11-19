"""Общий уровень ложного успеха при промежуточном (Хайбиттл — Пето) и итоговом анализе.
Доля информации на промежуточном = 1755/3375. Монте-Карло, seed 1. Запуск: python3 alpha_hp.py"""
import random, math
t = 1755/3375; a1, a2 = 0.005, 0.05
z1 = 2.807; z2 = float(__import__("sys").argv[1]) if len(__import__("sys").argv) > 1 else 1.960  # итоговый порог z
random.seed(1); N = 400000; hit = 0
for _ in range(N):
    w1 = random.gauss(0, 1) * math.sqrt(t); w2 = w1 + random.gauss(0, 1) * math.sqrt(1 - t)
    if abs(w1/math.sqrt(t)) > z1 or abs(w2) > z2: hit += 1
print(f"# α при двух анализах (alpha_hp.py)\n\nДоля информации на промежуточном: {t:.2f}; пороги z: {z1} / {z2}\n\n"
      f"Общий α (Монте-Карло, {N} повторов): **{hit/N:.4f}** (номинал 0,05)")
