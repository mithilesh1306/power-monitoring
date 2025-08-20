# Real-Time Power Monitoring Dashboard

This project is a web-based dashboard designed to display real-time power consumption data. It was built using modern frontend technologies and connects to a Google Firebase Realtime Database to receive and display live data streams.

## 1. Problem Statement

The goal was to create a user-friendly, responsive interface for monitoring electricity usage. The primary technical challenge was to establish a live connection to a backend data source (Firebase) and have the frontend components update instantly and efficiently as new data arrives, without requiring page reloads.

## 2. Tech Stack

* **Frontend:** HTML5, CSS3, JavaScript (ES6)
* **Backend & Database:** Google Firebase (Realtime Database & Authentication)
* **Deployment:** Netlify

## 3. Key Features

* **User Authentication:** A secure login and registration system using Firebase Authentication to ensure only authorized users can view the dashboard.
* **Live Data Dashboard:** A clean and intuitive dashboard that displays power monitoring metrics, which update in real-time as new data is pushed to the Firebase database.
* **Responsive Design:** The interface is fully responsive and provides a seamless experience on both desktop and mobile devices.

## 4. Challenges and What I Learned

A key challenge was implementing the real-time data listeners with Firebase and ensuring the UI updated efficiently without performance issues. This project significantly improved my skills in asynchronous JavaScript and working with modern NoSQL, real-time databases. I also gained valuable experience in deploying and hosting a live frontend application using Netlify.
