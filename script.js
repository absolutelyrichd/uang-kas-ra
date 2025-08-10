        document.addEventListener('DOMContentLoaded', function () {
            // Global data arrays
            let cashflowData = [];
            let paymentData = []; // This will now store member names and their payment status objects
            
            // NEW: Pagination state
            let currentPage = 1;
            const transactionsPerPage = 10;

            // --- DYNAMIC MONTHS & YEARS ---
            // Generate months for the current and next year for payment selection
            const generatePaymentMonths = () => {
                const paymentMonthsList = [];
                const currentYear = new Date().getFullYear();
                const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
                
                // Add months for the current year
                for (let i = 0; i < 12; i++) {
                    paymentMonthsList.push(`${monthNames[i]} ${currentYear}`);
                }
                // Add months for the next year
                for (let i = 0; i < 12; i++) {
                    paymentMonthsList.push(`${monthNames[i]} ${currentYear + 1}`);
                }
                return paymentMonthsList;
            };

            const paymentMonths = generatePaymentMonths(); // Used for payment periods and status tracking.
            const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']; // Kept for year-agnostic features like the AI month filter.

            const formatCurrency = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(value);

            // --- Firebase Configuration & Initialization ---
            // __firebase_config, __app_id, and __initial_auth_token are provided by the Canvas environment.
            // If running outside Canvas, firebaseConfig will be empty and __initial_auth_token undefined.
            const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' && Object.keys(JSON.parse(__firebase_config)).length > 0 ? __firebase_config : JSON.stringify({
                apiKey: "AIzaSyBuoxTcp7_C5LdOtU_vKlkvQNVLtdZK68Y",
                authDomain: "uang-kas-ra.firebaseapp.com",
                projectId: "uang-kas-ra",
                storageBucket: "uang-kas-ra.firebasestorage.app",
                messagingSenderId: "635210671608",
                appId: "1:635210671608:web:36dd4007f60a2ab434a20d",
                measurementId: "G-EJHTNTCHXJ"
            }));
            const appId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.projectId; // Use projectId as default appId

            // Initialize Firebase app if config is not empty
            let app;
            let auth;
            let db;

            // Check if firebaseConfig is not empty before initializing
            if (Object.keys(firebaseConfig).length > 0) {
                app = firebase.initializeApp(firebaseConfig);
                auth = firebase.auth();
                db = firebase.firestore();
            } else {
                console.error("Firebase config is empty. Please provide Firebase configuration.");
                // Provide dummy functions if Firebase is not initialized to prevent errors
                auth = { onAuthStateChanged: (cb) => cb(null), signInWithPopup: () => Promise.reject('Firebase not configured'), signOut: () => Promise.resolve() };
                db = { collection: () => ({ doc: () => ({ set: () => Promise.resolve(), delete: () => Promise.resolve(), onSnapshot: () => () => {} }) }) };
                document.getElementById('authStatus').textContent = 'Firebase tidak terkonfigurasi. Data tidak akan disimpan ke cloud.';
            }

            let currentUserUid = null; // To store the current user's UID
            let firestoreUserDataDocRef = null; // Reference to the user's data document in Firestore
            let dataUnsubscribe = null; // To store the Firestore snapshot listener unsubscribe function

            const signInButton = document.getElementById('signInButton');
            const signOutButton = document.getElementById('signOutButton');
            const authStatusDiv = document.getElementById('authStatus');
            const appContent = document.getElementById('appContent');

            // --- Firebase Authentication Functions ---

            // Handle Google Sign-In
            signInButton.addEventListener('click', async () => {
                try {
                    const provider = new firebase.auth.GoogleAuthProvider();
                    await auth.signInWithPopup(provider);
                    // onAuthStateChanged will handle UI and data loading
                } catch (error) {
                    console.error("Error during Google Sign-In:", error);
                    authStatusDiv.textContent = `Login Gagal: ${error.message}`;
                }
            });

            // Handle Sign-Out
            signOutButton.addEventListener('click', async () => {
                try {
                    await auth.signOut();
                    // onAuthStateChanged will handle UI and data clearing
                } catch (error) {
                    console.error("Error during Sign-Out:", error);
                    authStatusDiv.textContent = `Logout Gagal: ${error.message}`;
                }
            });

            // Auth State Change Listener
            auth.onAuthStateChanged(async (user) => {
                if (user) {
                    // User is signed in.
                    currentUserUid = user.uid;
                    authStatusDiv.textContent = `Selamat datang, ${user.displayName || user.email}!`;
                    signInButton.classList.add('hidden');
                    signOutButton.classList.remove('hidden');
                    appContent.classList.remove('hidden'); // Show app content

                    // Set up Firestore data reference for the current user
                    // Private data collection: /artifacts/{appId}/users/{userId}/uangKasData/{docId}
                    // We'll use a single document named 'userData' for simplicity
                    firestoreUserDataDocRef = db.collection('artifacts').doc(appId).collection('users').doc(currentUserUid).collection('uangKasData').doc('userData');

                    // Stop any existing listener before starting a new one
                    if (dataUnsubscribe) {
                        dataUnsubscribe();
                    }

                    // Set up real-time listener for user data
                    dataUnsubscribe = firestoreUserDataDocRef.onSnapshot(doc => {
                        if (doc.exists) {
                            const data = doc.data();
                            cashflowData = data.cashflow || [];
                            paymentData = data.payments || [];
                            document.getElementById('dataManagementMessage').textContent = 'Data berhasil disinkronkan dari Firebase.';
                        } else {
                            // Document does not exist, initialize with a basic Admin member and save
                            console.log("Tidak ada data pengguna yang ditemukan di Firestore. Menginisialisasi dengan data kosong.");
                            cashflowData = [];
                            paymentData = [
                                { docId: 'm0', nama: 'Admin', isSystem: true, pembayaran: {} }
                            ];
                            // Save initial data to Firestore
                            saveDataToFirestore();
                            document.getElementById('dataManagementMessage').textContent = 'Data baru diinisialisasi di Firebase.';
                        }
                        renderAllUI(); // Always re-render UI after data changes
                    }, (error) => {
                        console.error("Error listening to Firestore data:", error);
                        document.getElementById('dataManagementMessage').textContent = 'Gagal menyinkronkan data dari Firebase.';
                    });

                } else {
                    // User is signed out.
                    currentUserUid = null;
                    authStatusDiv.textContent = 'Silakan login untuk menyimpan data Anda.';
                    signInButton.classList.remove('hidden');
                    signOutButton.classList.add('hidden');
                    appContent.classList.add('hidden'); // Hide app content

                    // Clear local data when user logs out
                    cashflowData = [];
                    paymentData = [];
                    renderAllUI();
                    document.getElementById('dataManagementMessage').textContent = '';

                    // Stop listening to Firestore data if user logs out
                    if (dataUnsubscribe) {
                        dataUnsubscribe();
                        dataUnsubscribe = null;
                    }

                    // Handle Canvas initial authentication token
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token !== null && __initial_auth_token !== '') {
                         // Sign in with custom token if provided by Canvas environment
                        try {
                             auth.signInWithCustomToken(__initial_auth_token)
                                .then(() => console.log("Signed in with custom token (Canvas environment)."))
                                .catch(error => {
                                    console.error("Error signing in with custom token:", error);
                                });
                        } catch (error) {
                             console.error("Error attempting signInWithCustomToken:", error);
                        }
                    } else {
                        // Fallback to anonymous sign-in if no custom token is provided
                        try {
                            auth.signInAnonymously()
                                .then(() => console.log("Signed in anonymously (default)."))
                                .catch(error => {
                                    console.error("Error signing in anonymously:", error);
                                });
                        } catch (error) {
                             console.error("Error attempting signInAnonymously:", error);
                        }
                    }
                }
            });


            // --- Firestore Data Persistence Functions (replacing Local Storage) ---

            /**
             * Saves data (cashflow and payments) to Firestore for the current user.
             * This function is called after any data modification.
             */
            async function saveDataToFirestore() {
                if (!currentUserUid || !firestoreUserDataDocRef) {
                    console.warn("Pengguna tidak terautentikasi atau referensi data belum diatur. Tidak dapat menyimpan ke Firestore.");
                    document.getElementById('dataManagementMessage').textContent = 'Tidak dapat menyimpan: Belum login atau koneksi Firebase belum siap.';
                    return;
                }
                try {
                    await firestoreUserDataDocRef.set({
                        cashflow: cashflowData,
                        payments: paymentData,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp() // Add timestamp for tracking
                    }, { merge: true }); // Use merge to avoid overwriting the entire document if other fields exist
                    // The onSnapshot listener will update the UI, no need for direct UI update here for message.
                } catch (e) {
                    console.error('Error saving to Firestore:', e);
                    document.getElementById('dataManagementMessage').textContent = `Gagal menyimpan data ke Firebase: ${e.message}`;
                }
            }

            // --- Data Operations (now primarily interacting with Firestore) ---

            function addTransaction(transaction) {
                // Generate client-side docId if not already present (for consistency with original logic)
                transaction.docId = transaction.docId || Date.now().toString();
                cashflowData.push(transaction);
                saveDataToFirestore(); // Trigger save to Firestore
            }
            
            // NEW: Update an existing transaction
            function updateTransaction(docId, updatedData) {
                const transactionIndex = cashflowData.findIndex(item => item.docId === docId);
                if (transactionIndex > -1) {
                    // Keep the original docId
                    cashflowData[transactionIndex] = { ...updatedData, docId: docId };
                    saveDataToFirestore();
                }
            }

            async function deleteTransaction(docId) {
                cashflowData = cashflowData.filter(item => item.docId !== docId);
                await saveDataToFirestore(); // Trigger save to Firestore
            }

            function addMember(memberName) {
                const newMember = { docId: Date.now().toString(), nama: memberName, pembayaran: {} };
                paymentData.push(newMember);
                saveDataToFirestore(); // Trigger save to Firestore
            }

            async function editMember(docId, newName) {
                const memberIndex = paymentData.findIndex(member => member.docId === docId);
                if (memberIndex > -1) {
                    const oldName = paymentData[memberIndex].nama;
                    paymentData[memberIndex].nama = newName;

                    // Update existing transactions with the old member name to the new name
                    cashflowData.forEach(transaction => {
                        if (transaction.penyetorPengambil === oldName) {
                            transaction.penyetorPengambil = newName;
                        }
                    });
                    await saveDataToFirestore(); // Trigger save to Firestore
                }
            }

            async function deleteMember(docId) {
                const memberToDelete = paymentData.find(member => member.docId === docId);
                if (memberToDelete) {
                    const memberName = memberToDelete.nama;
                    paymentData = paymentData.filter(member => member.docId !== docId); // Remove member
                    cashflowData = cashflowData.filter(transaction => transaction.penyetorPengambil !== memberName); // Remove associated transactions
                }
                await saveDataToFirestore(); // Trigger save to Firestore
            }

            async function clearInMemoryData() {
                if (!currentUserUid || !firestoreUserDataDocRef) {
                    document.getElementById('dataManagementMessage').textContent = 'Tidak dapat menghapus: Belum login atau koneksi Firebase belum siap.';
                    return;
                }
                showConfirmationModal('Apakah Anda yakin ingin menghapus SEMUA data dari Firebase? Tindakan ini tidak dapat dibatalkan.', async () => {
                    try {
                        await firestoreUserDataDocRef.delete(); // Delete document from Firestore
                        // onSnapshot listener will clear local data and re-render UI
                        // so no need to manually clear cashflowData and paymentData here.
                        // The onSnapshot will receive a 'doc.exists' false event and re-initialize with admin.
                        document.getElementById('dataManagementMessage').textContent = 'Semua data telah dihapus dari Firebase!';
                    } catch (e) {
                        console.error('Error deleting data from Firestore:', e);
                        document.getElementById('dataManagementMessage').textContent = `Gagal menghapus data dari Firebase: ${e.message}`;
                    }
                });
            }

            // --- UI Rendering Functions ---
            function renderAllUI() {
                updateAllPaymentStatuses(); // Update payment statuses before rendering
                calculateKPIs();
                renderCashflowChart();
                renderMonthlyComparisonChart();
                renderTransactionCards(document.getElementById('transactionSearch').value, currentPage);
                renderPaymentTable(); // Render payment table with all months
                renderMemberTable();
                populateTransactionWhoDropdowns(); // Populate dropdowns for both add and edit modals
                populatePaymentPeriodDropdowns(); // Populate new payment period dropdowns
                populatePdfMonthCheckboxes(); // Ensure PDF month checkboxes are populated
                populateAiMonthFilter(); // Populate AI month filter
            }

            function calculateKPIs() {
                let totalIncome = 0;
                let totalExpense = 0;
                cashflowData.forEach(item => {
                    totalIncome += item.pemasukan;
                    totalExpense += item.pengeluaran;
                });
                const currentBalance = totalIncome - totalExpense;

                document.getElementById('currentBalance').textContent = formatCurrency(currentBalance);
                document.getElementById('totalIncome').textContent = formatCurrency(totalIncome);
                document.getElementById('totalExpense').textContent = formatCurrency(totalExpense);
            }

            let cashflowChartInstance = null;
            function renderCashflowChart() {
                const ctx = document.getElementById('cashflowChart').getContext('2d');
                const labels = [];
                const balanceData = [];
                let runningBalance = 0;

                const sortedCashflowData = [...cashflowData].sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));

                sortedCashflowData.forEach(item => {
                    runningBalance += item.pemasukan - item.pengeluaran;
                    labels.push(new Date(item.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }));
                    balanceData.push(runningBalance);
                });

                if (cashflowChartInstance) {
                    cashflowChartInstance.destroy();
                }

                cashflowChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Saldo Kas',
                            data: balanceData,
                            borderColor: '#f59e0b',
                            backgroundColor: 'rgba(245, 158, 11, 0.1)',
                            fill: true,
                            tension: 0.3,
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                beginAtZero: false,
                                ticks: {
                                    callback: function(value) {
                                        return formatCurrency(value);
                                    }
                                }
                            }
                        },
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        return `Saldo: ${formatCurrency(context.raw)}`;
                                    }
                                }
                            }
                        }
                    }
                });
            }

            let monthlyComparisonChartInstance = null;
            function renderMonthlyComparisonChart() {
                const ctx = document.getElementById('monthlyComparisonChart').getContext('2d');
                const monthlyData = {};

                cashflowData.forEach(item => {
                    const monthIndex = new Date(item.tanggal).getMonth();
                    const monthName = months[monthIndex];
                    if (!monthlyData[monthName]) {
                        monthlyData[monthName] = { pemasukan: 0, pengeluaran: 0 };
                    }
                    monthlyData[monthName].pemasukan += item.pemasukan;
                    monthlyData[monthName].pengeluaran += item.pengeluaran;
                });

                const chartLabels = Object.keys(monthlyData);
                const incomeDataset = chartLabels.map(month => monthlyData[month].pemasukan);
                const expenseDataset = chartLabels.map(month => monthlyData[month].pengeluaran);

                if (monthlyComparisonChartInstance) {
                    monthlyComparisonChartInstance.destroy();
                }

                monthlyComparisonChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: chartLabels,
                        datasets: [
                            {
                                label: 'Pemasukan',
                                data: incomeDataset,
                                backgroundColor: '#10b981',
                                borderRadius: 4,
                            },
                            {
                                label: 'Pengeluaran',
                                data: expenseDataset,
                                backgroundColor: '#ef4444',
                                borderRadius: 4,
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: function(value) {
                                        return formatCurrency(value);
                                    }
                                }
                            }
                        },
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        return `${context.dataset.label}: ${formatCurrency(context.raw)}`;
                                    }
                                }
                            }
                        }
                    }
                });
            }

            // NEW: Function to render transactions as cards
            function renderTransactionCards(filter = '', page = 1) {
                const cardContainer = document.getElementById('transactionCardContainer');
                cardContainer.innerHTML = '';
                
                currentPage = page;

                const sortedData = [...cashflowData].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
                
                // Filter data before grouping
                const filteredData = sortedData.filter(item =>
                    item.keterangan.toLowerCase().includes(filter.toLowerCase()) ||
                    (item.penyetorPengambil && item.penyetorPengambil.toLowerCase().includes(filter.toLowerCase()))
                );

                if (filteredData.length === 0) {
                    cardContainer.innerHTML = `<div class="p-4 text-center text-slate-500 col-span-full">Tidak ada transaksi yang cocok.</div>`;
                    renderPaginationControls(0, page);
                    return;
                }
                
                // Group transactions by date
                const groupedByDate = filteredData.reduce((acc, transaction) => {
                    const date = transaction.tanggal;
                    if (!acc[date]) {
                        acc[date] = {
                            transactions: [],
                            totalIncome: 0,
                            totalExpense: 0
                        };
                    }
                    acc[date].transactions.push(transaction);
                    acc[date].totalIncome += transaction.pemasukan;
                    acc[date].totalExpense += transaction.pengeluaran;
                    return acc;
                }, {});

                const sortedDates = Object.keys(groupedByDate).sort((a, b) => new Date(b) - new Date(a));

                const startIndex = (page - 1) * transactionsPerPage;
                const endIndex = page * transactionsPerPage;
                const paginatedDates = sortedDates.slice(startIndex, endIndex);

                paginatedDates.forEach(date => {
                    const dayData = groupedByDate[date];
                    let transactionsHtml = '';

                    dayData.transactions.forEach(item => {
                        const amount = item.pemasukan > 0 ? formatCurrency(item.pemasukan) : formatCurrency(item.pengeluaran);
                        const amountColor = item.pemasukan > 0 ? 'text-emerald-600' : 'text-red-600';
                        const amountSign = item.pemasukan > 0 ? '+' : '-';

                        transactionsHtml += `
                            <div class="flex items-center justify-between py-2 border-b last:border-b-0 border-slate-200">
                                <div class="flex-grow">
                                    <p class="font-medium text-sm text-slate-800">${item.keterangan} (${item.penyetorPengambil || 'Anonim'})</p>
                                    <p class="text-xs ${amountColor}">${amountSign} ${amount}</p>
                                </div>
                                <div class="flex-shrink-0">
                                    <button data-doc-id="${item.docId}" class="edit-transaction-button text-blue-600 hover:text-blue-900 mr-2 text-sm">Edit</button>
                                    <button data-doc-id="${item.docId}" class="delete-transaction-button text-red-600 hover:text-red-900 text-sm">Hapus</button>
                                </div>
                            </div>
                        `;
                    });

                    const cardHtml = `
                        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <div class="flex items-center justify-between mb-2 pb-2 border-b border-slate-200">
                                <h4 class="text-md font-semibold text-slate-900">${new Date(date).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</h4>
                            </div>
                            <div class="flex justify-between text-sm mb-2">
                                <div>
                                    <span class="font-medium text-slate-500">Pemasukan Harian:</span>
                                    <span class="font-semibold text-emerald-600">${formatCurrency(dayData.totalIncome)}</span>
                                </div>
                                <div>
                                    <span class="font-medium text-slate-500">Pengeluaran Harian:</span>
                                    <span class="font-semibold text-red-600">${formatCurrency(dayData.totalExpense)}</span>
                                </div>
                            </div>
                            <div class="mt-4 border-t border-slate-200 pt-4">
                                <p class="text-sm font-semibold text-slate-700 mb-2">Detail Transaksi:</p>
                                ${transactionsHtml}
                            </div>
                        </div>
                    `;
                    cardContainer.innerHTML += cardHtml;
                });

                // Attach event listeners to the newly created buttons
                document.querySelectorAll('.delete-transaction-button').forEach(button => {
                    button.addEventListener('click', (e) => {
                        const docId = e.target.dataset.docId;
                        showConfirmationModal(`Apakah Anda yakin ingin menghapus transaksi ini?`, () => {
                            deleteTransaction(docId);
                        });
                    });
                });
                
                document.querySelectorAll('.edit-transaction-button').forEach(button => {
                    button.addEventListener('click', (e) => {
                        const docId = e.target.dataset.docId;
                        const transaction = cashflowData.find(t => t.docId === docId);
                        if (transaction) {
                            showEditTransactionModal(transaction);
                        }
                    });
                });

                renderPaginationControls(sortedDates.length, page);
            }

            function renderPaginationControls(totalItems, page) {
                const paginationControls = document.getElementById('paginationControls');
                paginationControls.innerHTML = '';
                const totalPages = Math.ceil(totalItems / transactionsPerPage);

                if (totalPages <= 1) return;

                let paginationHTML = `
                    <span class="text-sm text-slate-700">
                        Halaman ${page} dari ${totalPages}
                    </span>
                    <div class="flex items-center">
                        <button id="prevPage" class="pagination-button bg-white border border-slate-300 text-slate-700 font-semibold py-1 px-3 rounded-l-lg" ${page === 1 ? 'disabled' : ''}>
                            Sebelumnya
                        </button>
                `;

                // Page numbers logic (simplified for brevity)
                for (let i = 1; i <= totalPages; i++) {
                    paginationHTML += `
                        <button class="pagination-button page-number-button bg-white border-t border-b border-slate-300 text-slate-700 font-semibold py-1 px-3 ${i === page ? 'active' : ''}" data-page="${i}">
                            ${i}
                        </button>
                    `;
                }

                paginationHTML += `
                        <button id="nextPage" class="pagination-button bg-white border border-slate-300 text-slate-700 font-semibold py-1 px-3 rounded-r-lg" ${page === totalPages ? 'disabled' : ''}>
                            Berikutnya
                        </button>
                    </div>
                `;

                paginationControls.innerHTML = paginationHTML;

                document.getElementById('prevPage')?.addEventListener('click', () => {
                    if (currentPage > 1) {
                        renderTransactionCards(document.getElementById('transactionSearch').value, currentPage - 1);
                    }
                });

                document.getElementById('nextPage')?.addEventListener('click', () => {
                    if (currentPage < totalPages) {
                        renderTransactionCards(document.getElementById('transactionSearch').value, currentPage + 1);
                    }
                });

                document.querySelectorAll('.page-number-button').forEach(button => {
                    button.addEventListener('click', (e) => {
                        const newPage = parseInt(e.target.dataset.page);
                        renderTransactionCards(document.getElementById('transactionSearch').value, newPage);
                    });
                });
            }


            // Modified: renderPaymentTable to display all months as columns
            function renderPaymentTable() {
                const tableHeader = document.getElementById('paymentTableHeader');
                const tableBody = document.getElementById('paymentTableBody');
                tableBody.innerHTML = ''; // Clear existing rows

                // Clear and re-populate table headers
                tableHeader.innerHTML = `<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider sticky left-0 bg-slate-50 z-10">Nama Anggota</th>`;
                paymentMonths.forEach(monthYear => {
                    tableHeader.innerHTML += `<th scope="col" class="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wider">${monthYear.replace(' ', '<br>')}</th>`;
                });

                // Filter out system users like 'Admin' from payment tracking
                const filteredPaymentData = paymentData.filter(member => !member.isSystem);

                if (filteredPaymentData.length === 0) {
                    tableBody.innerHTML = `<tr><td colspan="${paymentMonths.length + 1}" class="text-center py-4 text-slate-500">Tidak ada anggota terdaftar.</td></tr>`;
                    return;
                }

                // Sort filteredPaymentData alphabetically by nama before rendering
                const sortedPaymentData = [...filteredPaymentData].sort((a, b) => a.nama.localeCompare(b.nama));

                sortedPaymentData.forEach(member => {
                    let rowHtml = `<tr><td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-800 sticky left-0 bg-white">${member.nama}</td>`;
                    paymentMonths.forEach(monthYear => {
                        const status = member.pembayaran[monthYear] || 'Belum';
                        const statusClass = status === 'Lunas' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800';
                        rowHtml += `
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-center">
                                <span class="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">
                                    ${status}
                                </span>
                            </td>
                        `;
                    });
                    rowHtml += `</tr>`;
                    tableBody.innerHTML += rowHtml;
                });
            }

            // New function to automatically update payment status based on cashflow data
            function updateAllPaymentStatuses() {
                // Reset all payment statuses to 'Belum' initially for all members for all months
                paymentData.forEach(member => {
                    // Only reset for non-system users
                    if (!member.isSystem) {
                        member.pembayaran = {}; // Clear old payments
                        paymentMonths.forEach(monthYear => {
                            member.pembayaran[monthYear] = 'Belum';
                        });
                    }
                });

                // Iterate through cashflow data to find payments from registered members
                cashflowData.forEach(transaction => {
                    // Only consider income transactions
                    if (transaction.pemasukan > 0) {
                        const payerName = transaction.penyetorPengambil ? transaction.penyetorPengambil.toLowerCase() : '';
                        const member = paymentData.find(m => m.nama.toLowerCase() === payerName && !m.isSystem); // Exclude system users

                        if (member) {
                            if (transaction.startMonth && transaction.endMonth) {
                                // Handle multi-month payment
                                const startIndex = paymentMonths.indexOf(transaction.startMonth);
                                const endIndex = paymentMonths.indexOf(transaction.endMonth);

                                if (startIndex !== -1 && endIndex !== -1 && startIndex <= endIndex) {
                                    for (let i = startIndex; i <= endIndex; i++) {
                                        member.pembayaran[paymentMonths[i]] = 'Lunas';
                                    }
                                } else {
                                    // Fallback if start/end months are invalid, use transaction month
                                    const transactionDate = new Date(transaction.tanggal);
                                    const transactionMonthName = months[transactionDate.getMonth()];
                                    const transactionYear = transactionDate.getFullYear();
                                    const transactionMonthYear = `${transactionMonthName} ${transactionYear}`;
                                    if(member.pembayaran.hasOwnProperty(transactionMonthYear)) {
                                       member.pembayaran[transactionMonthYear] = 'Lunas';
                                    }
                                }
                            } else {
                                // Original single-month payment logic
                                const transactionDate = new Date(transaction.tanggal);
                                const transactionMonthName = months[transactionDate.getMonth()];
                                const transactionYear = transactionDate.getFullYear();
                                const transactionMonthYear = `${transactionMonthName} ${transactionYear}`;
                                if(member.pembayaran.hasOwnProperty(transactionMonthYear)) {
                                   member.pembayaran[transactionMonthYear] = 'Lunas';
                                }
                            }
                        }
                    }
                });
            }

            function renderMemberTable() {
                const memberTableBody = document.getElementById('memberTableBody');
                memberTableBody.innerHTML = '';
                if (paymentData.length === 0) {
                    memberTableBody.innerHTML = `<tr><td colspan="2" class="text-center py-4 text-slate-500">Tidak ada anggota terdaftar.</td></tr>`;
                    return;
                }
                // Filter out system users like 'Admin'
                const filteredPaymentData = paymentData.filter(member => !member.isSystem);
                // Sort filteredPaymentData alphabetically by nama before rendering
                const sortedPaymentData = [...filteredPaymentData].sort((a, b) => a.nama.localeCompare(b.nama));

                sortedPaymentData.forEach(member => {
                    const row = `
                        <tr>
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-800">${member.nama}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                <button data-doc-id="${member.docId}" class="edit-member-button text-blue-600 hover:text-blue-900 mr-2">Edit</button>
                                <button data-doc-id="${member.docId}" class="delete-member-button text-red-600 hover:text-red-900">Hapus</button>
                            </td>
                        </tr>
                    `;
                    memberTableBody.innerHTML += row;
                });

                document.querySelectorAll('.delete-member-button').forEach(button => {
                    button.addEventListener('click', (e) => {
                        const docId = e.target.dataset.docId;
                        const memberName = e.target.closest('tr').querySelector('td').textContent;
                        showConfirmationModal(`Apakah Anda yakin ingin menghapus anggota "${memberName}"? Ini juga akan menghapus semua transaksi terkait dengan anggota ini.`, () => {
                            deleteMember(docId);
                        });
                    });
                });

                document.querySelectorAll('.edit-member-button').forEach(button => {
                    button.addEventListener('click', (e) => {
                        const docId = e.target.dataset.docId;
                        const member = paymentData.find(m => m.docId === docId);
                        if (member) {
                            showEditMemberModal(member.docId, member.nama);
                        }
                    });
                });
            }

            // Function to populate the "Penyetor / Pengambil" dropdowns in both modals
            function populateTransactionWhoDropdowns(transactionType = 'pemasukan') {
                const addSelect = document.getElementById('transactionWho');
                const editSelect = document.getElementById('editTransactionWho');
                
                [addSelect, editSelect].forEach(select => {
                    select.innerHTML = '<option value="">Pilih Anggota (Opsional)</option>'; // Reset and add default option
                    const sortedPaymentData = [...paymentData].sort((a, b) => a.nama.localeCompare(b.nama));
                    sortedPaymentData.forEach(member => {
                        const option = document.createElement('option');
                        option.value = member.nama;
                        option.textContent = member.nama;
                        // For 'Admin', only add if current transaction type is pengeluaran
                        if (member.isSystem && transactionType !== 'pengeluaran') {
                           // do not add admin
                        } else {
                            select.appendChild(option);
                        }
                    });
                });
            }

            // Add a new function to populate the payment period dropdowns
            function populatePaymentPeriodDropdowns() {
                const startMonthSelect = document.getElementById('paymentPeriodStartMonth');
                const endMonthSelect = document.getElementById('paymentPeriodEndMonth');
                const editStartMonthSelect = document.getElementById('editPaymentPeriodStartMonth');
                const editEndMonthSelect = document.getElementById('editPaymentPeriodEndMonth');

                const selects = [startMonthSelect, endMonthSelect, editStartMonthSelect, editEndMonthSelect];

                selects.forEach(select => {
                    if (select) {
                        select.innerHTML = '<option value="">Pilih Bulan (Opsional)</option>';
                        paymentMonths.forEach(monthYear => {
                            const option = document.createElement('option');
                            option.value = monthYear;
                            option.textContent = monthYear;
                            select.appendChild(option);
                        });
                    }
                });
                
                const currentMonth = months[new Date().getMonth()];
                const currentYear = new Date().getFullYear();
                const currentMonthYear = `${currentMonth} ${currentYear}`;

                // Set default for ADD modal
                startMonthSelect.value = currentMonthYear;
                endMonthSelect.value = currentMonthYear;
            }

            // Function to populate the AI Month Filter Dropdown
            function populateAiMonthFilter() {
                const aiMonthFilter = document.getElementById('aiMonthFilter');
                aiMonthFilter.innerHTML = ''; // Clear existing options
                const currentYear = new Date().getFullYear();
                months.forEach(month => {
                    const option = document.createElement('option');
                    const monthYear = `${month} ${currentYear}`;
                    option.value = month; // The value is just the month name, as used in the event listener
                    option.textContent = monthYear;
                    aiMonthFilter.appendChild(option);
                });
            }

            // --- MODAL LOGIC ---
            
            // Generic function to open a modal
            function openModal(modalId) {
                const modal = document.getElementById(modalId);
                if (modal) {
                    modal.style.display = 'flex';
                    // Apply blur effect to the body
                    document.body.style.filter = 'blur(5px)';
                    document.body.style.transition = 'filter 0.3s ease-in-out';
                }
            }

            // Generic function to close a modal
            function closeModal(modalId) {
                const modal = document.getElementById(modalId);
                if (modal) {
                    modal.style.display = 'none';
                    // Remove blur effect from the body
                    document.body.style.filter = 'none';
                }
            }
            
            // Confirmation Modal
            const confirmationModal = document.getElementById('confirmationModal');
            const modalMessage = document.getElementById('modalMessage');
            const confirmYesButton = document.getElementById('confirmYes');
            const confirmNoButton = document.getElementById('confirmNo');
            const closeConfirmButton = document.querySelector('#confirmationModal .close-button');
            let confirmCallback = null;

            function showConfirmationModal(message, callback) {
                modalMessage.textContent = message;
                confirmCallback = callback;
                openModal('confirmationModal');
            }
            
            closeConfirmButton.addEventListener('click', () => closeModal('confirmationModal'));
            confirmNoButton.addEventListener('click', () => closeModal('confirmationModal'));
            confirmYesButton.addEventListener('click', async () => {
                if (confirmCallback) {
                    await confirmCallback();
                }
                closeModal('confirmationModal');
            });

            // Edit Member Modal
            const editMemberModal = document.getElementById('editMemberModal');
            const closeEditMemberModalButton = document.getElementById('closeEditMemberModal');
            const editMemberNameInput = document.getElementById('editMemberNameInput');
            const saveEditedMemberNameButton = document.getElementById('saveEditedMemberName');
            const cancelEditMemberNameButton = document.getElementById('cancelEditMemberName');
            let currentEditMemberId = null;

            function showEditMemberModal(docId, currentName) {
                currentEditMemberId = docId;
                editMemberNameInput.value = currentName;
                openModal('editMemberModal');
            }
            
            closeEditMemberModalButton.addEventListener('click', () => closeModal('editMemberModal'));
            cancelEditMemberNameButton.addEventListener('click', () => closeModal('editMemberModal'));
            saveEditedMemberNameButton.addEventListener('click', () => {
                const newName = editMemberNameInput.value.trim();
                if (newName && currentEditMemberId) {
                    editMember(currentEditMemberId, newName);
                    closeModal('editMemberModal');
                } else {
                    showConfirmationModal('Nama anggota tidak boleh kosong.', () => {});
                }
            });

            // NEW: Add Transaction Modal
            const addTransactionModal = document.getElementById('addTransactionModal');
            const openAddTransactionModalButton = document.getElementById('openAddTransactionModalButton');
            const closeAddTransactionModalButton = document.getElementById('closeAddTransactionModal');

            openAddTransactionModalButton.addEventListener('click', () => openModal('addTransactionModal'));
            closeAddTransactionModalButton.addEventListener('click', () => closeModal('addTransactionModal'));

            // NEW: Edit Transaction Modal
            const editTransactionModal = document.getElementById('editTransactionModal');
            const closeEditTransactionModalButton = document.getElementById('closeEditTransactionModal');
            const cancelEditTransactionButton = document.getElementById('cancelEditTransaction');

            function showEditTransactionModal(transaction) {
                document.getElementById('editTransactionId').value = transaction.docId;
                document.getElementById('editTransactionDate').value = transaction.tanggal;
                document.getElementById('editTransactionDesc').value = transaction.keterangan;
                
                const isIncome = transaction.pemasukan > 0;
                
                // For multi-month payments, the stored amount is the total. We need to show the per-month amount.
                let amountToShow = isIncome ? transaction.pemasukan : transaction.pengeluaran;
                if (isIncome && transaction.startMonth && transaction.endMonth) {
                    const startIndex = paymentMonths.indexOf(transaction.startMonth);
                    const endIndex = paymentMonths.indexOf(transaction.endMonth);
                    if (startIndex !== -1 && endIndex !== -1 && startIndex <= endIndex) {
                        const numberOfMonths = endIndex - startIndex + 1;
                        if (numberOfMonths > 0) {
                            amountToShow = transaction.pemasukan / numberOfMonths;
                        }
                    }
                }

                document.getElementById('editTransactionAmount').value = amountToShow;
                document.querySelector(`input[name="editTransactionType"][value="pemasukan"]`).checked = isIncome;
                document.querySelector(`input[name="editTransactionType"][value="pengeluaran"]`).checked = !isIncome;
                
                populateTransactionWhoDropdowns(isIncome ? 'pemasukan' : 'pengeluaran');
                document.getElementById('editTransactionWho').value = transaction.penyetorPengambil || '';

                // Populate and set payment period dropdowns
                document.getElementById('editPaymentPeriodStartMonth').value = transaction.startMonth || '';
                document.getElementById('editPaymentPeriodEndMonth').value = transaction.endMonth || '';
                
                openModal('editTransactionModal');
            }
            
            closeEditTransactionModalButton.addEventListener('click', () => closeModal('editTransactionModal'));
            cancelEditTransactionButton.addEventListener('click', () => closeModal('editTransactionModal'));

            // Close modals if clicked outside
            window.addEventListener('click', (event) => {
                if (event.target.classList.contains('modal')) {
                    event.target.style.display = 'none';
                    // Remove blur effect
                    document.body.style.filter = 'none';
                }
            });


            // --- Event Listeners ---
            document.getElementById('transactionSearch').addEventListener('input', (e) => {
                renderTransactionCards(e.target.value, 1); // Reset to page 1 on new search
            });

            // Tab switching logic
            const tabTransactions = document.getElementById('tab-transactions');
            const tabPayments = document.getElementById('tab-payments');
            const tabMemberManagement = document.getElementById('tab-member-management');
            const tabDataManagement = document.getElementById('tab-data-management');
            const tabAiInsights = document.getElementById('tab-ai-insights');
            const tabPdfSettings = document.getElementById('tab-pdf-settings');

            const contentTransactions = document.getElementById('content-transactions');
            const contentPayments = document.getElementById('content-payments');
            const contentMemberManagement = document.getElementById('content-member-management');
            const contentDataManagement = document.getElementById('content-data-management');
            const contentAiInsights = document.getElementById('content-ai-insights');
            const contentPdfSettings = document.getElementById('content-pdf-settings');

            const allTabs = [tabTransactions, tabPayments, tabMemberManagement, tabDataManagement, tabAiInsights, tabPdfSettings];
            const allContents = [contentTransactions, contentPayments, contentMemberManagement, contentDataManagement, contentAiInsights, contentPdfSettings];

            function switchTab(activeTabButton, activeContentDiv) {
                allTabs.forEach(tab => tab.classList.remove('active'));
                allContents.forEach(content => content.classList.add('hidden'));
                activeTabButton.classList.add('active');
                activeContentDiv.classList.remove('hidden');
            }

            // Set a default tab to be active on load
            switchTab(tabTransactions, contentTransactions);

            tabTransactions.addEventListener('click', () => switchTab(tabTransactions, contentTransactions));
            tabPayments.addEventListener('click', () => switchTab(tabPayments, contentPayments));
            tabMemberManagement.addEventListener('click', () => switchTab(tabMemberManagement, contentMemberManagement));
            tabDataManagement.addEventListener('click', () => switchTab(tabDataManagement, contentDataManagement));
            tabAiInsights.addEventListener('click', () => switchTab(tabAiInsights, contentAiInsights));
            tabPdfSettings.addEventListener('click', () => switchTab(tabPdfSettings, contentPdfSettings));

            // Transaction Form Submission (for ADDING)
            document.getElementById('transactionForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const date = document.getElementById('transactionDate').value;
                const desc = document.getElementById('transactionDesc').value;
                let amount = parseFloat(document.getElementById('transactionAmount').value); // Nominal per bulan
                const type = document.querySelector('input[name="transactionType"]:checked').value;
                const who = document.getElementById('transactionWho').value;
                const startMonth = document.getElementById('paymentPeriodStartMonth').value;
                const endMonth = document.getElementById('paymentPeriodEndMonth').value;

                let actualAmount = amount; // Nominal yang akan dicatat di transaksi

                if (type === 'pemasukan' && startMonth && endMonth) {
                    const startIndex = paymentMonths.indexOf(startMonth);
                    const endIndex = paymentMonths.indexOf(endMonth);
                    if (startIndex !== -1 && endIndex !== -1 && startIndex <= endIndex) {
                        const numberOfMonths = endIndex - startIndex + 1;
                        actualAmount = amount * numberOfMonths; // Hitung total nominal
                    }
                }

                const newTransaction = {
                    tanggal: date,
                    keterangan: desc,
                    pemasukan: type === 'pemasukan' ? actualAmount : 0, // Gunakan actualAmount
                    pengeluaran: type === 'pengeluaran' ? amount : 0,
                    penyetorPengambil: who || 'Anonim'
                };

                // Tambahkan startMonth dan endMonth hanya jika ini adalah pemasukan dan keduanya dipilih
                if (type === 'pemasukan' && startMonth && endMonth) {
                    newTransaction.startMonth = startMonth;
                    newTransaction.endMonth = endMonth;
                }

                const spinner = document.getElementById('addTransactionSpinner');
                spinner.classList.remove('hidden');
                document.getElementById('transactionForm').querySelector('button[type="submit"]').disabled = true;

                addTransaction(newTransaction);

                spinner.classList.add('hidden');
                document.getElementById('transactionForm').querySelector('button[type="submit"]').disabled = false;
                document.getElementById('transactionForm').reset();
                document.getElementById('transactionDate').valueAsDate = new Date();
                populatePaymentPeriodDropdowns(); // Reset new payment period dropdowns
                closeModal('addTransactionModal');
            });

            // NEW: Transaction Form Submission (for EDITING)
            document.getElementById('editTransactionForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const docId = document.getElementById('editTransactionId').value;
                const date = document.getElementById('editTransactionDate').value;
                const desc = document.getElementById('editTransactionDesc').value;
                let amount = parseFloat(document.getElementById('editTransactionAmount').value); // This is per-month amount
                const type = document.querySelector('input[name="editTransactionType"]:checked').value;
                const who = document.getElementById('editTransactionWho').value;
                const startMonth = document.getElementById('editPaymentPeriodStartMonth').value;
                const endMonth = document.getElementById('editPaymentPeriodEndMonth').value;

                let actualAmount = amount; // This will be the total amount saved

                if (type === 'pemasukan' && startMonth && endMonth) {
                    const startIndex = paymentMonths.indexOf(startMonth);
                    const endIndex = paymentMonths.indexOf(endMonth);
                    if (startIndex !== -1 && endIndex !== -1 && startIndex <= endIndex) {
                        const numberOfMonths = endIndex - startIndex + 1;
                        actualAmount = amount * numberOfMonths; // Recalculate total amount
                    }
                }

                const updatedTransaction = {
                    tanggal: date,
                    keterangan: desc,
                    pemasukan: type === 'pemasukan' ? actualAmount : 0,
                    pengeluaran: type === 'pengeluaran' ? amount : 0, // Pengeluaran is not per-month
                    penyetorPengambil: who || 'Anonim'
                };

                // Add startMonth and endMonth only if it's an income transaction and both are selected
                if (type === 'pemasukan' && startMonth && endMonth) {
                    updatedTransaction.startMonth = startMonth;
                    updatedTransaction.endMonth = endMonth;
                }
                
                const spinner = document.getElementById('editTransactionSpinner');
                spinner.classList.remove('hidden');
                document.getElementById('editTransactionForm').querySelector('button[type="submit"]').disabled = true;
                
                updateTransaction(docId, updatedTransaction);

                spinner.classList.add('hidden');
                document.getElementById('editTransactionForm').querySelector('button[type="submit"]').disabled = false;
                closeModal('editTransactionModal');
            });


            // Add Member Button
            document.getElementById('addMemberButton').addEventListener('click', async () => {
                const newMemberNameInput = document.getElementById('newMemberName');
                const memberName = newMemberNameInput.value.trim();
                if (memberName) {
                    const spinner = document.getElementById('addMemberSpinner');
                    spinner.classList.remove('hidden');
                    document.getElementById('addMemberButton').disabled = true;

                    addMember(memberName);

                    spinner.classList.add('hidden');
                    document.getElementById('addMemberButton').disabled = false;
                    newMemberNameInput.value = '';
                } else {
                    showConfirmationModal('Nama anggota tidak boleh kosong.', () => {});
                }
            });

            // Data Management Buttons
            document.getElementById('downloadDataButton').addEventListener('click', downloadDataAsJson);
            document.getElementById('downloadReportButton').addEventListener('click', () => {
                generatePdfReport();
                document.getElementById('dataManagementMessage').textContent = 'Laporan berhasil diunduh sebagai laporan_uang_kas.pdf';
            });
            document.getElementById('uploadDataButton').addEventListener('click', () => {
                document.getElementById('uploadFileInput').click();
            });
            document.getElementById('uploadFileInput').addEventListener('change', loadDataFromFile);
            document.getElementById('clearInMemoryDataButton').addEventListener('click', clearInMemoryData); // Call clearInMemoryData (now clears Firebase)

            // Auto Download Setting (for local backup only)
            document.getElementById('autoDownloadInterval').addEventListener('change', (e) => {
                const minutes = parseInt(e.target.value);
                startAutoDownload(minutes);
            });

            // --- File Operations (Download/Upload for Backup) ---
            function downloadDataAsJson() {
                const dataToSave = {
                    cashflow: cashflowData,
                    payments: paymentData // paymentData will contain derived statuses when saved
                };
                const jsonString = JSON.stringify(dataToSave, null, 2);
                const blob = new Blob([jsonString], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'data_uang_kas_backup.json'; // Changed filename to indicate backup
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                document.getElementById('dataManagementMessage').textContent = 'Data berhasil diunduh sebagai data_uang_kas_backup.json';
            }

            let autoDownloadIntervalId = null; // To store the interval ID
            let autoDownloadMinutes = 0; // Current interval in minutes

            function startAutoDownload(minutes) {
                if (autoDownloadIntervalId) {
                    clearInterval(autoDownloadIntervalId);
                }
                if (minutes > 0) {
                    autoDownloadMinutes = minutes;
                    autoDownloadIntervalId = setInterval(() => {
                        downloadDataAsJson();
                        document.getElementById('autoDownloadStatus').textContent = `Backup terakhir diunduh: ${new Date().toLocaleTimeString('id-ID')}`;
                    }, minutes * 60 * 1000); // Convert minutes to milliseconds
                    document.getElementById('autoDownloadStatus').textContent = `Backup otomatis aktif setiap ${minutes} menit.`;
                } else {
                    autoDownloadMinutes = 0;
                    document.getElementById('autoDownloadStatus').textContent = 'Backup otomatis nonaktif.';
                }
            }

            async function loadDataFromFile(event) {
                const file = event.target.files[0];
                if (!file) {
                    document.getElementById('dataManagementMessage').textContent = 'Tidak ada file yang dipilih.';
                    return;
                }

                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        const loadedData = JSON.parse(e.target.result);
                        if (loadedData.cashflow && loadedData.payments) {
                            cashflowData = loadedData.cashflow;
                            paymentData = loadedData.payments;
                            await saveDataToFirestore(); // Save uploaded data to Firebase
                            document.getElementById('dataManagementMessage').textContent = `Data berhasil dimuat dari file "${file.name}" dan disimpan ke Firebase.`;
                        } else {
                            document.getElementById('dataManagementMessage').textContent = 'Format file JSON tidak valid. Pastikan berisi "cashflow" dan "payments".';
                        }
                    } catch (error) {
                        console.error('Error parsing JSON or saving to Firestore:', error);
                        document.getElementById('dataManagementMessage').textContent = `Gagal memuat file: ${error.message}. Pastikan file adalah JSON yang valid.`;
                    }
                };
                reader.onerror = () => {
                    document.getElementById('dataManagementMessage').textContent = 'Gagal membaca file.';
                };
                reader.readAsText(file);
            }

            // AI Features Logic
            document.getElementById('generateSpendingAnalysis').addEventListener('click', async () => {
                const selectedMonth = document.getElementById('aiMonthFilter').value;
                const filteredExpenses = cashflowData.filter(item =>
                    new Date(item.tanggal).getMonth() === months.indexOf(selectedMonth) && item.pengeluaran > 0
                );

                let expenseDetails = filteredExpenses.map(item =>
                    `- ${item.keterangan} (${item.penyetorPengambil || 'Anonim'}): ${formatCurrency(item.pengeluaran)}`
                ).join('\n');

                if (expenseDetails === '') {
                    expenseDetails = 'Tidak ada pengeluaran tercatat untuk bulan ini.';
                }

                const prompt = `Berdasarkan data transaksi pengeluaran berikut untuk bulan ${selectedMonth}:\n${expenseDetails}\n\nBerikan ringkasan singkat tentang pola pengeluaran utama dan kategori terbesar untuk bulan ini. Fokus pada pengeluaran. Format sebagai paragraf singkat dalam bahasa Indonesia.`;

                await callGeminiAPI(
                    prompt,
                    document.getElementById('spendingAnalysisOutput'),
                    document.getElementById('spendingAnalysisSpinner')
                );
            });

            document.getElementById('generatePaymentReminder').addEventListener('click', async () => {
                // For the AI reminder, we will now consider all months to find unpaid members
                let unpaidMembersByMonth = {};
                paymentMonths.forEach(monthYear => {
                    unpaidMembersByMonth[monthYear] = paymentData.filter(member =>
                        !member.isSystem && member.pembayaran[monthYear] === 'Belum'
                    ).map(member => member.nama);
                });

                let reminderTextParts = [];
                for (const monthYear of paymentMonths) {
                    if (unpaidMembersByMonth[monthYear].length > 0) {
                        reminderTextParts.push(`anggota berikut yang belum membayar iuran bulan ${monthYear}: ${unpaidMembersByMonth[monthYear].join(', ')}`);
                    }
                }

                let prompt = '';
                if (reminderTextParts.length > 0) {
                    prompt = `Buatkan draf pesan pengingat pembayaran iuran kas yang sopan untuk ${reminderTextParts.join(' dan ')}. Pesan harus singkat, jelas, dan mendorong pembayaran tanpa terkesan menuntut. Mulai dengan sapaan umum dan sebutkan bulan iuran. Format sebagai paragraf singkat dalam bahasa Indonesia.`;
                } else {
                    prompt = 'Tidak ada anggota yang belum membayar untuk bulan yang dipilih.';
                }

                await callGeminiAPI(
                    prompt,
                    document.getElementById('paymentReminderOutput'),
                    document.getElementById('paymentReminderSpinner')
                );
            });

            async function callGeminiAPI(prompt, outputElement, spinnerElement) {
                outputElement.innerHTML = '<p class="text-slate-500">Memuat...</p>';
                spinnerElement.classList.remove('hidden');
                try {
                    let chatHistory = [];
                    chatHistory.push({ role: "user", parts: [{ text: prompt }] });
                    const payload = { contents: chatHistory };
                    const apiKey = ""; // API key will be provided by Canvas runtime
                    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
                    const response = await fetch(apiUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload)
                            });
                    const result = await response.json();
                    if (result.candidates && result.candidates.length > 0 &&
                        result.candidates[0].content && result.candidates[0].content.parts &&
                        result.candidates[0].content.parts.length > 0) {
                        const text = result.candidates[0].content.parts[0].text;
                        outputElement.innerHTML = `<p>${text}</p>`;
                    } else {
                        outputElement.innerHTML = `<p class="text-red-500">Gagal mendapatkan respons dari AI. Coba lagi.</p>`;
                    }
                } catch (error) {
                    console.error('Error calling Gemini API:', error);
                    outputElement.innerHTML = `<p class="text-red-500">Terjadi kesalahan: ${error.message}.</p>`;
                } finally {
                    spinnerElement.classList.add('hidden');
                }
            }

            document.getElementById('transactionDate').valueAsDate = new Date();

            // PDF Report Month Selection Logic
            const pdfMonthSelectionDiv = document.getElementById('pdfMonthSelection');
            const selectAllPdfMonthsButton = document.getElementById('selectAllPdfMonths');
            const clearAllPdfMonthsButton = document.getElementById('clearAllPdfMonths');

            function populatePdfMonthCheckboxes() {
                pdfMonthSelectionDiv.innerHTML = '';
                paymentMonths.forEach((monthYear, index) => {
                    const div = document.createElement('div');
                    div.className = 'flex items-center';
                    div.innerHTML = `
                        <input type="checkbox" id="pdfMonth-${index}" name="pdfMonth" value="${monthYear}" class="form-checkbox h-4 w-4 text-amber-600 rounded focus:ring-amber-500" checked>
                        <label for="pdfMonth-${index}" class="ml-2 text-sm text-slate-700">${monthYear}</label>
                    `;
                    pdfMonthSelectionDiv.appendChild(div);
                });
            }

            selectAllPdfMonthsButton.addEventListener('click', () => {
                document.querySelectorAll('#pdfMonthSelection input[type="checkbox"]').forEach(checkbox => {
                    checkbox.checked = true;
                });
            });

            clearAllPdfMonthsButton.addEventListener('click', () => {
                document.querySelectorAll('#pdfMonthSelection input[type="checkbox"]').forEach(checkbox => {
                    checkbox.checked = false;
                });
            });

            // Call this on initial load
            populatePdfMonthCheckboxes();
            renderAllUI();
            startAutoDownload(0);
        });
