$ErrorActionPreference = "Stop"

$backend = "D:\heatshield\backend"
$buildDir = "$backend\build"
$staging = "$buildDir\lambda-package"
$zipPath = "$buildDir\heatshield-lambda.zip"
$pip = "$backend\venv\Scripts\pip.exe"

Write-Host "Cleaning old build directories..."
if (Test-Path $buildDir) {
    Remove-Item $buildDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $staging | Out-Null

Write-Host "Installing dependencies for Linux x86_64, Python 3.12..."
& $pip install -r "$backend\requirements.txt" -t $staging `
    --platform manylinux2014_x86_64 `
    --implementation cp `
    --python-version 3.12 `
    --abi cp312 `
    --only-binary=:all: `
    --quiet

Write-Host "Copying application code..."
Copy-Item -Path "$backend\main.py" -Destination $staging
Copy-Item -Path "$backend\lambda_handler.py" -Destination $staging
Copy-Item -Path "$backend\recommender.py" -Destination $staging
Copy-Item -Path "$backend\heat" -Destination $staging -Recurse
Copy-Item -Path "$backend\routing" -Destination $staging -Recurse

Write-Host "Removing __pycache__ and unwanted files..."
Get-ChildItem -Path $staging -Recurse -Filter "__pycache__" | Remove-Item -Recurse -Force

Write-Host "Creating ZIP archive (this may take a moment)..."
Compress-Archive -Path "$staging\*" -DestinationPath $zipPath

Write-Host "Checking ZIP size..."
$size = (Get-Item $zipPath).Length
$sizeMb = [math]::Round($size / 1MB, 2)
Write-Host "ZIP Size: $sizeMb MB"

if ($sizeMb -gt 50) {
    Write-Host "WARNING: ZIP exceeds Lambda's 50MB compressed direct upload limit."
} else {
    Write-Host "SUCCESS: ZIP size is well within the 50MB direct upload limit."
}

Write-Host "Running smoke test on packaged files..."
Set-Location $staging

Write-Host "Verifying native extensions..."
$soFiles = Get-ChildItem -Path . -Recurse -Filter "*.so"
$pydFiles = Get-ChildItem -Path . -Recurse -Filter "*.pyd"

if ($soFiles.Count -eq 0) {
    Write-Host "Smoke test failed: No Linux .so native extensions found (pydantic-core missing?)."
    exit 1
}
if ($pydFiles.Count -gt 0) {
    Write-Host "Smoke test failed: Windows .pyd native extensions found in Linux package!"
    exit 1
}
Write-Host "Native extensions verified: found $($soFiles.Count) .so files, 0 .pyd files."

Write-Host "Testing import in Linux container (python:3.12-slim)..."
docker run --rm -v "$($PWD):/var/task" -w /var/task -e ORS_API_KEY=dummy_key_for_test -e ENVIRONMENTAL_PROVIDER=demo python:3.12-slim python -c "
import sys
sys.path.insert(0, '')
import lambda_handler
print('Smoke test SUCCESS. handler:', type(lambda_handler.handler))
"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Smoke test failed in Linux container!"
    exit 1
}

Write-Host "Done. Your Lambda package is at: $zipPath"
