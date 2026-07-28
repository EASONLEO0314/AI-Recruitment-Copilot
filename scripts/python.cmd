@echo off
set "PYTHONPATH=%~dp0..\.venv\Lib\site-packages;%PYTHONPATH%"
py -3.14 %*
