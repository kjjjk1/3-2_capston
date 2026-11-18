"""Compatibility entry point. Use collect-public.py for the documented options."""
import runpy,pathlib
runpy.run_path(str(pathlib.Path(__file__).with_name('collect-public.py')),run_name='__main__')
