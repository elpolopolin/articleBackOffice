const quill = new Quill('#editor', {
    theme: 'snow',
    modules: {
        toolbar: [
            [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
            [{ 'size': ['small', false, 'large', 'huge'] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'color': [] }, { 'background': [] }],
            [{ 'align': [] }],
            ['link', 'image'],
            ['clean']
        ]
    },
    placeholder: 'Start writing your article...'
});

async function saveArticle() {
    const title = document.getElementById('articleTitle').value;
    const content = quill.root.innerHTML;
    
    // Extract images from content
    const images = Array.from(quill.root.querySelectorAll('img'));
    const formData = new FormData();
    
    formData.append('title', title);
    formData.append('content', content);
    
    // Upload images
    for (let i = 0; i < images.length; i++) {
        const response = await fetch(images[i].src);
        const blob = await response.blob();
        formData.append('images', blob, `image-${i}.png`);
    }
    
    try {
        const response = await fetch('/api/articles', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            window.location.href = '/';
        } else {
            alert('Error saving article');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error saving article');
    }
}