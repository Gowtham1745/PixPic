$ErrorActionPreference = 'Stop'

$models = @(
    @{
        Name = 'RealESRGAN_x2plus.pth'
        Url = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/RealESRGAN_x2plus.pth'
    },
    @{
        Name = 'RealESRGAN_x4plus.pth'
        Url = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/RealESRGAN_x4plus.pth'
    },
    @{
        Name = 'RealESRGAN_x4plus_anime_6B.pth'
        Url = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/RealESRGAN_x4plus_anime_6B.pth'
    }
)

$destination = Join-Path $PSScriptRoot 'models'
New-Item -ItemType Directory -Force -Path $destination | Out-Null

foreach ($model in $models) {
    $path = Join-Path $destination $model.Name
    if (Test-Path $path) {
        Write-Host "Already present: $($model.Name)"
        continue
    }
    Write-Host "Downloading $($model.Name)..."
    Invoke-WebRequest -Uri $model.Url -OutFile $path
}
