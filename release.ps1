param([Parameter(Mandatory = $true)][string]$Version)
Set-Location $PSScriptRoot

$env:V = $Version
node -e "const fs=require('fs');const p='apps/desktop/src-tauri/tauri.conf.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.version=process.env.V;fs.writeFileSync(p,JSON.stringify(c,null,2));"

git add .
git status --short
$ok = Read-Host "Bu değişiklikler v$Version olarak yayınlansın mı? (e/h)"
if ($ok -ne "e") { git reset | Out-Null; Write-Host "İptal edildi."; exit }

git commit -m "Sürüm $Version"
git push
git tag "v$Version"
git push origin "v$Version"
Write-Host "v$Version gönderildi. GitHub > Actions sekmesinden derlemeyi izle."