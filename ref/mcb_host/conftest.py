"""Make the flat module layout importable under pytest.

This folder is the project root: config.py / protocol.py / serial_link.py / gui.py
sit directly here (no package). pytest collects this conftest and adds its
directory to sys.path, so tests can do ``from config import ...`` regardless of
the current working directory. The explicit insert below is belt-and-suspenders.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
