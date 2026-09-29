"""A mixed-date snapshot must never overwrite a newly fetched day's prices."""
import json, os, sys, tempfile, unittest
from pathlib import Path
from datetime import datetime
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main

class MixedSnapshot(unittest.TestCase):
    def test_append_only_recovery(self):
        oldcwd=os.getcwd(); oldscope=main.RUN_SCOPE
        with tempfile.TemporaryDirectory() as td:
            try:
                os.chdir(td); main.RUN_SCOPE='us'
                Path('history/us').mkdir(parents=True)
                path=Path('history/us/2026-09-28.json')
                old={'ticker':'KO','last_date':'2026-09-25','price':70}
                valid={'ticker':'HQH','last_date':'2026-09-28','price':20}
                path.write_text(json.dumps({'stocks':[old,valid]})); before=path.read_bytes()
                self.assertEqual(set(main.frozen_day_rows('us','2026-09-28')), {'HQH'})
                row={'ticker':'KO','last_date':'2026-09-28','price':72,'hist':[]}
                main.freeze_signal_hist([row],{}, {}, [],False,{})
                self.assertEqual(row['price'],72)
                main.save_history([row,valid],{},datetime.now(main._KST))
                self.assertEqual(path.read_bytes(),before)
                extra=Path('history/us/2026-09-28/KO.json'); frozen=extra.read_bytes()
                self.assertEqual(main.frozen_day_rows('us','2026-09-28')['KO']['price'],72)
                row['price']=73
                main.freeze_signal_hist([row],{}, {}, [],False,{})
                self.assertEqual(row['price'],72)
                main.save_history([row,valid],{},datetime.now(main._KST))
                self.assertEqual(extra.read_bytes(),frozen)
            finally:
                os.chdir(oldcwd); main.RUN_SCOPE=oldscope

if __name__=='__main__': unittest.main()
