﻿Get-ChildItem -Path "C:\path\to\runtime\src\libraries" -Recurse -Filter "*.csproj" -File | 
    Where-Object { $_.FullName -notlike "*\ref\*" -and $_.FullName -notlike "*\tests\*" -and $_.FullName -notlike "*\gen\*" -and $_.FullName -notlike "*\shims\*" -and $_.FullName -notlike "*\tools\*" -and $_.FullName -notlike "*\System.Private*\*" -and $_.FullName -notlike "*\Fuzzing\*" } | 
    ForEach-Object {
        $content = Get-Content -Path $_.FullName -Raw
        if ($content -notmatch "UseCompilerGeneratedDocXmlFile") {
            $_.FullName
        }
    }
