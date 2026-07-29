@echo off
setlocal
set "PYTHONPATH=%~dp0..\.venv\Lib\site-packages;%PYTHONPATH%"

py -3.14 -c "import sys" >nul 2>&1
if not errorlevel 1 goto use_py_launcher

set "LOCAL_PYTHON=%LocalAppData%\Programs\Python\Python314\python.exe"
if exist "%LOCAL_PYTHON%" goto use_local_python

>&2 echo No usable Python 3.14 runtime found.
exit /b 1

:use_py_launcher
py -3.14 %*
exit /b %errorlevel%

:use_local_python
"%LOCAL_PYTHON%" %*
exit /b %errorlevel%
