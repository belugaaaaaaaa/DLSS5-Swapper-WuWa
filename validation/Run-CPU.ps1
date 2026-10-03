param([string]$Python='python')
$ErrorActionPreference='Stop'
& $Python -m unittest discover -s $PSScriptRoot -p test_shader_reference.py -v
if($LASTEXITCODE -ne 0){throw 'Product CPU oracle tests failed'}
