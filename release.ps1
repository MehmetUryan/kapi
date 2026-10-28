param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Note = ""
)
Set-Location $PSScriptRoot

$env:V = $Version
node -e "const fs=require('fs');const p='apps/desktop/src-tauri/tauri.conf.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.version=process.env.V;fs.writeFileSync(p,JSON.stringify(c,null,2));"

git add .
git status --short
$ok = Read-Host "Bu degisiklikler v$Version olarak yayinlansin mi? (e/h)"
if ($ok -ne "e") { git reset | Out-Null; Write-Host "Iptal edildi."; exit }

if ($Note) { $msg = "Release ${Version}: $Note" } else { $msg = "Release $Version" }
git commit -m $msg
git push
git tag "v$Version"
git push origin "v$Version"
Write-Host "v$Version gonderildi. GitHub > Actions sekmesinden derlemeyi izle."