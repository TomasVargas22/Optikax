# Informe simulado (sin llamar a la API)

Equipo: Intel Core i7-9700F, NVIDIA GeForce RTX 4060, 16 GB DDR4 en dos módulos, Windows 11 build 26200, escritorio.

## Ajustes del catálogo
- **HAGS (`hags_on`)**: con una RTX 40 conviene activarlo. Es requisito de DLSS Frame Generation y las pruebas de Blur Busters y de los foros de NVIDIA no muestran pérdidas en la serie 40.
- **Plan Máximo rendimiento (`power_ultimate`)**: en escritorio evita las bajadas de frecuencia del 9700F entre fotogramas. Recomendado.
- **Game DVR (`game_dvr_off`)**: la grabación en segundo plano consume encoder y disco. Recomendado desactivarla si no se usa.
- **Nagle (`nagle_off`)**: el efecto es discutido y la mayoría de juegos actuales usa UDP. No se recomienda.
- **Network throttling (`network_throttling_off`)**: sin pruebas que muestren mejoras en juegos modernos. No se recomienda.
- **Compresión de memoria (`memory_compression_off`)**: con 16 GB la compresión ayuda. No aplica.

## Manual
- Activar XMP en la BIOS: los módulos van a 2133 MHz y son de 3200 MHz.
- Activar Resizable BAR (la placa y la RTX 4060 lo admiten).
- Instalar el driver de NVIDIA con instalación limpia.

## Memoria
Con 16 GB, umbral de standby de 1024 MB y libre de 2048 MB.

## Advertencias
- El equipo ejecuta otro optimizador (KernelOS) que cambia el plan de energía.
