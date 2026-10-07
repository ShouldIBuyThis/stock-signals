"""Offline tests: real calendar and mocked Yahoo responses, no network."""
import ast
import unittest
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from types import SimpleNamespace
import pandas as pd
import numpy as np
import exchange_calendars as xcals

source = ast.parse(Path('main.py').read_text())
names = {'_session_str', 'latest_closed_us_session', '_fetch_daily', '_valid_last_day', '_quote_bar', '_patch_last_session'}
ns = dict(pd=pd, np=np, datetime=datetime, timedelta=timedelta, _NY=ZoneInfo('America/New_York'),
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

    # 2026-10-07 실패 재현: 야후 일봉이 최신 행(10/6)을 OHLC 없이 거래량만 준다.
    def _blank_last(self):
        idx=pd.date_range(end='2026-10-06',periods=130,freq='B').tz_localize('America/New_York')
        df=pd.DataFrame({'Open':100.0,'High':101.0,'Low':99.0,'Close':100.0,'Adj Close':100.0,'Volume':1e6},index=idx)
        df.loc[idx[-1],['Open','High','Low','Close','Adj Close']]=np.nan
        return df
    def _run(self, info):
        df=self._blank_last(); calls=[]
        def history(**kw): calls.append(kw); return df
        ns['yf']=SimpleNamespace(Ticker=lambda t:SimpleNamespace(history=history, get_info=lambda: info))
        ns['latest_closed_us_session']=lambda:'2026-10-06'
        try: return ns['_fetch_daily']('META'), calls
        finally: ns['latest_closed_us_session']=latest
    def _quote(self, **kw):
        ts=int(datetime(2026,10,6,16,0,tzinfo=ZoneInfo('America/New_York')).timestamp())
        q=dict(regularMarketTime=ts, regularMarketOpen=100.5, regularMarketDayHigh=103.0,
               regularMarketDayLow=100.2, regularMarketPrice=102.4, regularMarketVolume=2e6,
               regularMarketPreviousClose=100.0); q.update(kw); return q

    def test_blank_latest_row_restored_from_quote(self):
        out, calls = self._run(self._quote())
        self.assertEqual(len(calls), 2)                       # 재조회까지 했다
        self.assertEqual(ns['_valid_last_day'](out), '2026-10-06')
        last=out.iloc[-1]
        self.assertEqual((last['Close'],last['High'],last['Low'],last['Adj Close']),(102.4,103.0,100.2,102.4))
        self.assertEqual(last['Volume'], 1e6)                 # 일봉의 거래량이 있으면 그대로
        self.assertEqual(len(out), 130)                       # 과거 행 수 불변
        self.assertTrue((out.iloc[:-1]['Close']==100.0).all())

    def test_quote_wrong_day_is_rejected(self):
        ts=int(datetime(2026,10,5,16,0,tzinfo=ZoneInfo('America/New_York')).timestamp())
        out,_ = self._run(self._quote(regularMarketTime=ts))
        self.assertEqual(ns['_valid_last_day'](out), '2026-10-05')   # 기존처럼 미갱신 → 저장 전 실패

    def test_quote_prev_close_mismatch_is_rejected(self):
        out,_ = self._run(self._quote(regularMarketPreviousClose=50.0))
        self.assertEqual(ns['_valid_last_day'](out), '2026-10-05')

    def test_quote_out_of_range_is_rejected(self):
        out,_ = self._run(self._quote(regularMarketPrice=110.0))      # 고가 위 종가
        self.assertEqual(ns['_valid_last_day'](out), '2026-10-05')

if __name__=='__main__': unittest.main()
