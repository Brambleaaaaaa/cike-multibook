param(
    [Parameter(Mandatory = $true)]
    [string]$WebRoot,
    [Parameter(Mandatory = $true)]
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$androidRoot = Join-Path $projectRoot "android"
$webRoot = (Resolve-Path -LiteralPath $WebRoot).Path
$outputRoot = [System.IO.Path]::GetFullPath($OutputDir)
$buildRoot = Join-Path $outputRoot "_android-build"

if (-not $outputRoot.StartsWith([System.IO.Path]::GetFullPath($OutputDir))) {
    throw "Invalid output directory."
}
if ((Resolve-Path -LiteralPath $androidRoot).Path -eq $buildRoot) {
    throw "Build directory cannot be the Android source directory."
}

$jdk = "C:\Program Files (x86)\Android\openjdk\jdk-17.0.14"
$sdk = "C:\Program Files (x86)\Android\android-sdk"
$buildTools = Join-Path $sdk "build-tools\35.0.0"
$androidJar = Join-Path $sdk "platforms\android-35\android.jar"
$java = Join-Path $jdk "bin\java.exe"
$javac = Join-Path $jdk "bin\javac.exe"
$jar = Join-Path $jdk "bin\jar.exe"
$keytool = Join-Path $jdk "bin\keytool.exe"
$aapt2 = Join-Path $buildTools "aapt2.exe"
$d8 = Join-Path $buildTools "d8.bat"
$zipalign = Join-Path $buildTools "zipalign.exe"
$apksigner = Join-Path $buildTools "apksigner.bat"

$required = @(
    $java, $javac, $jar, $keytool, $aapt2, $d8, $zipalign, $apksigner,
    $androidJar, (Join-Path $webRoot "index.html")
)
foreach ($path in $required) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing build dependency: $path"
    }
}

$env:JAVA_HOME = $jdk
$env:Path = "$(Join-Path $jdk 'bin');$buildTools;$env:Path"

if (Test-Path -LiteralPath $buildRoot) {
    $resolvedBuild = (Resolve-Path -LiteralPath $buildRoot).Path
    if (-not $resolvedBuild.StartsWith($outputRoot)) {
        throw "Refusing to remove a build path outside the output directory."
    }
    Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
}

$genDir = Join-Path $buildRoot "generated"
$classesDir = Join-Path $buildRoot "classes"
$dexDir = Join-Path $buildRoot "dex"
$compiledRes = Join-Path $buildRoot "compiled-res.zip"
$unsignedApk = Join-Path $buildRoot "app-unsigned.apk"
$alignedApk = Join-Path $buildRoot "app-aligned.apk"
$signingDir = Join-Path $outputRoot "signing"
New-Item -ItemType Directory -Path $signingDir -Force | Out-Null
$keystore = Join-Path $signingDir "cike-release.keystore"
$signedApk = Join-Path $outputRoot "Cike-Multibook-3.2.15.apk"
$storePass = $env:CIKE_KEYSTORE_PASS
if ([string]::IsNullOrWhiteSpace($storePass)) {
    throw "请先设置环境变量 CIKE_KEYSTORE_PASS（签名证书密码），不要把它写进仓库。"
}
$alias = "cike"

New-Item -ItemType Directory -Path $genDir, $classesDir, $dexDir, $outputRoot -Force |
    Out-Null

& $aapt2 compile --dir (Join-Path $androidRoot "res") -o $compiledRes
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

& $aapt2 link `
    -o $unsignedApk `
    -I $androidJar `
    --manifest (Join-Path $androidRoot "AndroidManifest.xml") `
    -R $compiledRes `
    -A $webRoot `
    -0 mp3 `
    -0 m4a `
    -0 bin `
    -0 pdf `
    -0 webp `
    -0 jpg `
    -0 png `
    -0 woff2 `
    -0 ttf `
    -0 otf `
    --auto-add-overlay `
    --java $genDir
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

$sources = @(
    Get-ChildItem (Join-Path $androidRoot "src") -Recurse -Filter *.java |
        ForEach-Object FullName
) + @(
    Get-ChildItem $genDir -Recurse -Filter *.java |
        ForEach-Object FullName
)

$javacArgs = @(
    "-source", "8",
    "-target", "8",
    "-encoding", "UTF-8",
    "-bootclasspath", $androidJar,
    "-d", $classesDir
) + $sources
& $javac @javacArgs
if ($LASTEXITCODE -ne 0) { throw "javac failed" }

$classFiles = Get-ChildItem $classesDir -Recurse -Filter *.class |
    ForEach-Object FullName
$d8Args = @(
    "--lib", $androidJar,
    "--min-api", "23",
    "--output", $dexDir
) + $classFiles
& $d8 @d8Args
if ($LASTEXITCODE -ne 0) { throw "d8 failed" }

& $jar uf $unsignedApk -C $dexDir "classes.dex"
if ($LASTEXITCODE -ne 0) { throw "Adding classes.dex failed" }

& $zipalign -f -p 4 $unsignedApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

if (-not (Test-Path -LiteralPath $keystore)) {
    & $keytool `
        -genkeypair `
        -keystore $keystore `
        -storepass $storePass `
        -keypass $storePass `
        -alias $alias `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -dname "CN=Cike Multibook, OU=Personal Study, O=Cike, L=Shanghai, ST=Shanghai, C=CN"
    if ($LASTEXITCODE -ne 0) { throw "keytool failed" }
}

& $apksigner sign `
    --ks $keystore `
    --ks-key-alias $alias `
    --ks-pass "pass:$storePass" `
    --key-pass "pass:$storePass" `
    --v1-signing-enabled true `
    --v2-signing-enabled true `
    --out $signedApk `
    $alignedApk
if ($LASTEXITCODE -ne 0) { throw "apksigner failed" }

& $apksigner verify --verbose $signedApk
if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed" }

$hash = Get-FileHash -LiteralPath $signedApk -Algorithm SHA256
$info = [ordered]@{
    apk = $signedApk
    bytes = (Get-Item -LiteralPath $signedApk).Length
    sha256 = $hash.Hash
    minAndroid = "6.0"
    version = "3.2.15"
}
$info | ConvertTo-Json |
    Set-Content -LiteralPath (Join-Path $outputRoot "build-info.json") -Encoding UTF8
$info | Format-List
