# Copy 3 of 3 — the same date helper, in Python this time.
def format_date(value):
    d = parse(value)
    y = d.year
    m = str(d.month).zfill(2)
    day = str(d.day).zfill(2)
    return f"{y}-{m}-{day}"


def parse(value):
    from datetime import datetime

    return datetime.fromisoformat(value)


# A genuinely different helper — should stay unclustered.
def clamp(n, lo, hi):
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n
