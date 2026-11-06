plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Play needs a new, higher version code for every upload: CI passes the run number.
val ftrVersionCode = (System.getenv("FTR_VERSION_CODE") ?: "1").toInt()

android {
    namespace = "com.franklintiffinroom.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.franklintiffinroom.app"
        minSdk = 26
        targetSdk = 36
        versionCode = ftrVersionCode
        versionName = "1.0"
        buildConfigField("String", "API_BASE", "\"https://bot.franklintiffinroom.com/api/v1\"")
    }

    // Upload key for Google Play (Play re-signs with the app signing key).
    signingConfigs {
        create("upload") {
            val ks = System.getenv("FTR_UPLOAD_KEYSTORE")
            if (ks != null && file(ks).exists()) {
                storeFile = file(ks)
                storePassword = System.getenv("FTR_UPLOAD_STORE_PASSWORD")
                keyAlias = System.getenv("FTR_UPLOAD_KEY_ALIAS") ?: "upload"
                keyPassword = System.getenv("FTR_UPLOAD_KEY_PASSWORD") ?: System.getenv("FTR_UPLOAD_STORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            val upload = signingConfigs.getByName("upload")
            if (upload.storeFile != null) signingConfig = upload
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.05.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("androidx.core:core-splashscreen:1.0.1")

    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
}
