"""Offline tests: real calendar and mocked Yahoo responses, no network."""
import ast
import unittest
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from types import SimpleNamespace
import pandas as pd
import exchange_calendars as xcals

source = ast.parse(Path('main.py').read_text())
names = {'_session_str', 'latest_closed_us_session', '_fetch_daily'}
ns = dict(pd=pd, datetime=datetime, timedelta=timedelta, _NY=ZoneInfo('America/New_York'),
          _US_CAL=xcals.get_calendar('XNYS'), PERIOD='1y', is_kr_ticker=lambda t:t.endswith(('.KS','.KQ')))
exec(compile(ast.Module(body=[n for n in source.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[]), 'main.py', 'exec'), ns)
latest = ns['latest_closed_us_session']

class Freshness(unittest.TestCase):
    def test_calendar(self):
        for now, expected in [('2026-09-29T13:00:00+09:00','2026-09-28'),
                              ('2026-09-28T12:00:00-04:00','2026-09-25'),
                              ('2026-09-27T17:00:00-04:00','2026-09-25'),
                              ('2026-09-07T17:00:00-04:00','2026-09-04'),
                              ('2026-11-27T13:01:00-05:00','2026-11-27')]:
            self.assertEqual(latest(now), expected)

    def test_long_but_stale_response_retries(self):
        old=pd.DataFrame({'Close':range(130)},index=pd.date_range(end='2026-09-25',periods=130))
        new=pd.DataFrame({'Close':range(125)},index=pd.date_range(end='2026-09-28',periods=125))
        calls=[]
        def history(**kw):
            calls.append(kw); return old if 'period' in kw else new
        ns['yf']=SimpleNamespace(Ticker=lambda t:SimpleNamespace(history=history))
        ns['latest_closed_us_session']=lambda:'2026-09-28'
        try:
            result=ns['_fetch_daily']('QQQ')
            self.assertEqual(len(calls),2)
            self.assertEqual(str(result.index[-1].date()),'2026-09-28')
        finally:
            ns['latest_closed_us_session']=latest

if __name__=='__main__': unittest.main()
